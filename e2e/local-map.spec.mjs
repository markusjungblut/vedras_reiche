import { expect, test } from "@playwright/test";

async function openWithoutIntroduction(page, path = "/") {
  await page.addInitScript(() => localStorage.setItem("vedras-reiche-tutorial-progress", JSON.stringify({ introductionSeen: true, seen: {} })));
  await page.goto(path);
}

test("setup errors remain visible until they are dismissed on the welcome screen", async ({ page }) => {
  await openWithoutIntroduction(page);
  await page.getByRole("button", { name: "Lokales Testspiel" }).click();
  await page.getByLabel("Lokaler Seed (für reproduzierbare Ziehungen)").fill("-1");
  await page.getByRole("button", { name: "Kartenbau starten" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await page.clock.install();
  await page.clock.fastForward(5_100);
  await expect(alert).toHaveCount(1);
  await alert.getByRole("button", { name: "Fehlermeldung schließen" }).click();
  await expect(alert).toHaveCount(0);
});

test("action errors can be closed and transient domain errors expire after a resettable timeout", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();
  await page.clock.install();

  const alert = page.getByRole("alert");
  await page.getByRole("button", { name: "Ungültige Aktion testen" }).click();
  await expect(alert).toHaveCount(1);
  await alert.getByRole("button", { name: "Fehlermeldung schließen" }).click();
  await expect(alert).toHaveCount(0);

  await page.getByRole("button", { name: "Ungültige Aktion testen" }).click();
  await expect(alert).toHaveCount(1);
  await page.clock.fastForward(4_500);
  await page.getByRole("button", { name: "Ungültige Aktion testen" }).click();
  await expect(alert).toHaveCount(1);
  await page.clock.fastForward(700);
  await expect(alert).toHaveCount(1);
  await page.clock.fastForward(4_300);
  await expect(alert).toHaveCount(0);
});

test("local map creation, labels, zoom and pan use the live SVG map", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await openWithoutIntroduction(page);
  await expect(page.getByRole("button", { name: "Debug-Szenarien" })).toHaveCount(0);
  await page.getByRole("button", { name: "Lokales Testspiel" }).click();
  await page.getByRole("button", { name: "Kartenbau starten" }).click();

  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-map-color-regime", "SETUP_TERRITORIES");
  const box = await map.boundingBox();
  if (box === null) throw new Error("Rasterkarte hat keine Bildschirmgeometrie.");
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(x, box.y + box.height * step / 12);
  await page.mouse.up();
  await page.getByRole("button", { name: "Teilung bestätigen" }).click();
  await expect(page.getByText("Gebiete: 2 / 16")).toBeVisible();

  const beforeZoom = await map.getAttribute("viewBox");
  await map.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.wheel(0, -120);
  await expect(page.locator(".map-legend")).toContainText("116 %");
  await expect(map).not.toHaveAttribute("viewBox", beforeZoom ?? "");

  const beforePan = await map.getAttribute("viewBox");
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + 40, box.y + box.height / 2);
  await page.mouse.up({ button: "middle" });
  await expect(map).not.toHaveAttribute("viewBox", beforePan ?? "");
  await page.getByRole("button", { name: "Auf Karte einpassen" }).click();
  await expect(page.locator(".map-legend")).toContainText("100 %");
});

test("a territory remains selectable after viewport interaction", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();
  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  if (box === null) throw new Error("Rasterkarte hat keine Bildschirmgeometrie.");
  await map.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.wheel(0, -120);
  await page.locator('rect.map-cell[x="15"][y="10"]').click();
  await expect(page.locator(".map-summary")).not.toHaveText("Gebiet auswählen");
});

test("authoritative combat values reveal briefly before an exact border-gain wave", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Krieg · Grenzgewinn" }).click();
  const noSpade = page.getByRole("button", { name: "Keine", exact: true });
  await expect(noSpade).toHaveCount(2);
  await noSpade.first().click();
  await noSpade.first().click();

  const reveal = page.getByTestId("war-dice-reveal");
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText("W6");
  await page.getByRole("button", { name: "Grenzgewinn bestätigen" }).click();
  await expect(page.locator("rect.map-gain-overlay")).toHaveCount(5);
  await expect(page.getByLabel("Letztes Kampfergebnis")).toContainText("Normaler Grenzgewinn");
});

test("map modes and strategic-point effects are available in the player view", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Startauktionen" }).click();
  await expect(page.getByRole("img", { name: "Vedras Rasterkarte" })).toHaveAttribute("data-map-color-regime", "SETUP_TERRITORIES");
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();

  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(map).toHaveAttribute("data-map-color-regime", "OWNERSHIP");
  const ownedCell = map.locator('rect.map-cell[class*="owner-map-"]').first();
  await expect(ownedCell).toBeVisible();
  expect(await map.locator("rect.map-cell.map-cell-neutral").count()).toBeGreaterThan(0);
  const ownershipFill = await ownedCell.evaluate((element) => getComputedStyle(element).fill);

  for (const name of ["Gebiete", "Mein Reich", "Reiche", "Boni"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(map).toHaveAttribute("data-map-color-regime", "OWNERSHIP");
    expect(await ownedCell.evaluate((element) => getComputedStyle(element).fill)).toBe(ownershipFill);
  }
  await expect(map).toContainText(/G08\s*♠\s*12/);
  const bonusMode = page.getByRole("button", { name: "Boni", exact: true });
  await expect(bonusMode).toHaveClass(/selected-button/);

  await page.getByRole("button", { name: /Wahrzeichen ★/ }).click();
  await expect(page.getByRole("status")).toContainText("+25 % Wertung für dieses Gebiet");
});

test("the desktop table uses side space and keeps the territory overview below it", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();

  for (const width of [1366, 1600, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1200 });
    const [dashboard, personal, board, action, players, events, overview] = await Promise.all([
      page.locator(".dashboard").boundingBox(),
      page.locator(".personal-column").boundingBox(),
      page.locator(".board-column").boundingBox(),
      page.locator(".action-column").boundingBox(),
      page.locator(".players-column").boundingBox(),
      page.locator(".event-column").boundingBox(),
      page.locator(".territory-overview").boundingBox(),
    ]);
    if (!dashboard || !personal || !board || !action || !players || !events || !overview) throw new Error("Desktop-Spielansicht hat keine vollständige Geometrie.");
    expect(dashboard.width).toBeGreaterThan(width - 110);
    expect(personal.x).toBeLessThan(board.x);
    expect(board.width).toBeGreaterThan(440);
    expect(action.x).toBeGreaterThan(board.x + board.width - 1);
    expect(players.x).toBeGreaterThan(action.x + action.width - 1);
    expect(events.x).toBeGreaterThanOrEqual(action.x - 1);
    expect(events.x + events.width).toBeGreaterThanOrEqual(players.x + players.width - 1);
    expect(overview.y).toBeGreaterThan(board.y + board.height - 1);
  }
});

test("territory overview combines owner filters and stable sorting", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();

  const overview = page.locator(".territory-overview");
  const cards = overview.locator(".territory-card");
  const allCount = await cards.count();
  expect(allCount).toBeGreaterThan(0);
  await overview.getByRole("button", { name: "Meine", exact: true }).click();
  expect(await cards.count()).toBeGreaterThan(0);
  expect(await cards.count()).toBeLessThan(allCount);

  await overview.getByRole("button", { name: "Ben", exact: true }).click();
  expect((await cards.evaluateAll((elements) => elements.every((element) => element.getAttribute("data-territory-owner") === "ben")))).toBe(true);

  await overview.getByRole("button", { name: "Alle", exact: true }).click();
  await overview.getByRole("button", { name: "Symbol", exact: true }).click();
  const suits = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-territory-suit")));
  const suitOrder = ["DIAMONDS", "CLUBS", "HEARTS", "SPADES"];
  expect(suits.map((suit) => suitOrder.indexOf(suit))).toEqual([...suits].map((suit) => suitOrder.indexOf(suit)).sort((left, right) => left - right));

  await overview.getByRole("button", { name: /Größe ↓/ }).click();
  const descendingAreas = await cards.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-territory-area"))));
  expect(descendingAreas).toEqual([...descendingAreas].sort((left, right) => right - left));
  await overview.getByRole("button", { name: /Größe ↓/ }).click();
  await expect(overview.getByRole("button", { name: "Größe ↑", exact: true })).toHaveAttribute("aria-pressed", "true");
  const ascendingAreas = await cards.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-territory-area"))));
  expect(ascendingAreas).toEqual([...ascendingAreas].sort((left, right) => left - right));
});

test("direct drag pans without consuming the next territory click", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();
  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await page.getByRole("button", { name: "+", exact: true }).click();
  await map.hover();
  const box = await map.boundingBox();
  if (box === null) throw new Error("Rasterkarte hat keine Bildschirmgeometrie.");
  const beforePan = await map.getAttribute("viewBox");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await expect(map).not.toHaveAttribute("viewBox", beforePan ?? "");
  await expect(page.locator(".map-summary")).toHaveText("Gebiet auswählen");

  await page.locator('rect.map-cell[x="15"][y="10"]').click();
  await expect(page.locator(".map-summary")).not.toHaveText("Gebiet auswählen");
  await expect(page.locator(".personal-column .details-panel")).toBeVisible();
});

test("the border editor shows direct and automatic transfer previews", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Krieg · Grenzgewinn" }).click();
  const noSpade = page.getByRole("button", { name: "Keine" });
  await noSpade.first().click();
  await noSpade.last().click();

  await expect(page.getByRole("heading", { name: /Grenze verschieben/ })).toBeVisible();
  await expect(page.getByText(/Direkter Grenzgewinn:/)).toBeVisible();
  await expect(page.getByText(/Abgeschnittenes Land:/)).toBeVisible();
  await expect(page.getByText(/Gesamtübernahme:/)).toBeVisible();
});
