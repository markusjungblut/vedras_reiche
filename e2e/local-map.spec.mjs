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
  await expect(page.getByText("Der Grenzstift snappt präzise auf Rastervertices und erzeugt nur Kanten zwischen Zellen.")).toHaveCount(0);
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
  await expect(page.locator(".map-nav-controls")).toContainText("116 %");
  await expect(map).not.toHaveAttribute("viewBox", beforeZoom ?? "");

  const beforePan = await map.getAttribute("viewBox");
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + 40, box.y + box.height / 2);
  await page.mouse.up({ button: "middle" });
  await expect(map).not.toHaveAttribute("viewBox", beforePan ?? "");
  await page.getByRole("button", { name: "Einpassen" }).click();
  await expect(page.locator(".map-nav-controls")).toContainText("100 %");
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
  await page.getByRole("button", { name: "Krieg · ♠ + Festung" }).click();
  await expect(page.getByText("♠-Bonus verfügbar")).toBeVisible();
  await page.getByRole("button", { name: /♠ aus .*: \+2/ }).click();

  const reveal = page.getByTestId("war-dice-reveal");
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText("W6");
  await page.getByRole("button", { name: "Grenzgewinn bestätigen" }).click();
  await expect(page.locator("rect.map-gain-overlay")).not.toHaveCount(0);
  await expect(page.getByLabel("Letztes Kampfergebnis")).toContainText("Normaler Grenzgewinn");
});

test("map modes and strategic-point effects are available in the player view", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Startauktionen" }).click();
  const startAuctionMap = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(startAuctionMap).toHaveAttribute("data-map-color-regime", "OWNERSHIP");
  const auctionCells = startAuctionMap.locator("rect.map-cell.map-cell-current-auction");
  await expect(auctionCells.first()).toBeVisible();
  const neutralFills = await startAuctionMap.locator("rect.map-cell.map-cell-neutral").evaluateAll((cells) =>
    [...new Set(cells.map((cell) => getComputedStyle(cell).fill))]);
  expect(neutralFills).toHaveLength(1);
  const auctionTerritoryId = await auctionCells.first().getAttribute("data-territory-id");
  if (!auctionTerritoryId) throw new Error("Das aktuelle Startauktionsgebiet fehlt auf der Karte.");
  const auctionTerritoryCells = startAuctionMap.locator(`rect.map-cell[data-territory-id="${auctionTerritoryId}"]`);
  const auctionTerritoryCellCount = await auctionTerritoryCells.count();

  await page.getByLabel("Startgebot").selectOption("3");
  await page.getByRole("button", { name: "Gebot verdeckt abgeben" }).click();
  await page.getByLabel("Startgebot").selectOption("0");
  await page.getByRole("button", { name: "Gebot verdeckt abgeben" }).click();
  await page.getByLabel("Startgebot").selectOption("0");
  await page.getByRole("button", { name: "Gebot verdeckt abgeben" }).click();

  await expect(page.locator("rect.map-gain-overlay")).toHaveCount(auctionTerritoryCellCount);
  await expect(auctionTerritoryCells.first()).not.toHaveAttribute("data-owner-id", "");
  await expect(auctionTerritoryCells.first()).toHaveClass(/owner-map-/);
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();

  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(map).toHaveAttribute("data-map-color-regime", "OWNERSHIP");
  const ownedCell = map.locator('rect.map-cell[class*="owner-map-"]').first();
  await expect(ownedCell).toBeVisible();
  expect(await map.locator("rect.map-cell.map-cell-neutral").count()).toBeGreaterThan(0);
  const ownershipFill = await ownedCell.evaluate((element) => getComputedStyle(element).fill);

  for (const name of ["Gebiete", "Mein Reich", "Boni"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(map).toHaveAttribute("data-map-color-regime", "OWNERSHIP");
    expect(await ownedCell.evaluate((element) => getComputedStyle(element).fill)).toBe(ownershipFill);
  }
  await expect(page.getByRole("button", { name: "Reiche", exact: true })).toHaveCount(0);
  await expect(map).toContainText(/G08\s*♠\s*12/);
  const bonusMode = page.getByRole("button", { name: "Boni", exact: true });
  await expect(bonusMode).toHaveClass(/selected-button/);

  await page.getByRole("button", { name: /Wahrzeichen ★/ }).click();
  await expect(page.getByRole("status")).toContainText("+25 % Wertung für dieses Gebiet");
});

test("the scoring result shows remaining global influence separately from territory value", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Endwertung" }).click();
  await page.getByRole("button", { name: /Reich A/ }).click();

  const result = page.getByRole("region", { name: "Endergebnis" });
  await expect(result).toBeVisible();
  await expect(result.getByText("Gebietswertung", { exact: true }).first()).toBeVisible();
  await expect(result.getByText("Restlicher globaler Einfluss", { exact: true }).first()).toBeVisible();
  await expect(result.getByText("3 × 10 = 30", { exact: true })).toBeVisible();
  await expect(result.getByText("Gesamt", { exact: true }).first()).toBeVisible();
});

test("the desktop table uses side space and keeps the territory overview below it", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Aktivierungsphase" }).click();

  for (const width of [1366, 1600, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1200 });
    const [dashboard, details, board, action, right, players, events, overview] = await Promise.all([
      page.locator(".dashboard").boundingBox(),
      page.locator(".details-column").boundingBox(),
      page.locator(".board-column").boundingBox(),
      page.locator(".action-column").boundingBox(),
      page.locator(".right-column").boundingBox(),
      page.locator(".right-column .player-panel").boundingBox(),
      page.locator(".right-column .event-panel").boundingBox(),
      page.locator(".territory-overview").boundingBox(),
    ]);
    if (!dashboard || !details || !board || !action || !right || !players || !events || !overview) throw new Error("Desktop-Spielansicht hat keine vollständige Geometrie.");
    expect(dashboard.width).toBeGreaterThan(width - 110);
    expect(details.x).toBeLessThan(board.x);
    expect(board.width).toBeGreaterThan(440);
    expect(action.x).toBeGreaterThan(board.x + board.width - 1);
    expect(right.x).toBeGreaterThan(action.x + action.width - 1);
    expect(events.y).toBeGreaterThan(players.y);
    expect(Math.abs(action.height - board.height)).toBeLessThanOrEqual(2);
    expect(right.y + right.height).toBeLessThanOrEqual(board.y + board.height + 2);
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
  await page.getByRole("button", { name: "Karte vergrößern" }).click();
  await map.hover();
  const box = await map.boundingBox();
  if (box === null) throw new Error("Rasterkarte hat keine Bildschirmgeometrie.");
  const beforePan = await map.getAttribute("viewBox");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await expect(map).not.toHaveAttribute("viewBox", beforePan ?? "");
  await expect(page.locator(".map-summary")).toHaveCount(0);

  await page.locator('rect.map-cell[x="15"][y="10"]').click();
  await expect(page.locator(".map-summary")).toHaveCount(1);
  await expect(page.locator(".details-column .details-panel")).toBeVisible();
});

async function mapPointForGrid(map, x, y) {
  return map.evaluate((element, coordinate) => {
    const transform = element.getScreenCTM();
    if (transform === null) throw new Error("Rasterkarte hat keine Bildschirmtransformation.");
    const point = new DOMPoint(coordinate.x, coordinate.y).matrixTransform(transform);
    return { x: point.x, y: point.y };
  }, { x, y });
}

async function drawWarSplitBoundary(page, map, territoryId, startY, endY) {
  const cells = map.locator(`rect.map-cell[data-territory-id="${territoryId}"]`);
  const coordinates = await cells.evaluateAll((elements) => elements.map((cell) => ({
    x: Number(cell.getAttribute("x")), y: Number(cell.getAttribute("y")),
  })));
  const minimumX = Math.min(...coordinates.map((cell) => cell.x));
  const maximumX = Math.max(...coordinates.map((cell) => cell.x));
  const dividerX = (minimumX + maximumX + 1) / 2;
  const start = await mapPointForGrid(map, dividerX, startY);
  const end = await mapPointForGrid(map, dividerX, endY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(start.x + (end.x - start.x) * step / 12, start.y + (end.y - start.y) * step / 12);
  }
  await page.mouse.up();
}

test("war cut starts blank, derives a split from a boundary, and keeps cell tuning optional", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Krieg · Teilung" }).click();

  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(map).toBeVisible();
  const instruction = page.getByText(/Ziehe eine Grenze durch G\d+/);
  await expect(instruction).toBeVisible();
  await expect(map.locator("rect.map-cell-part-a")).toHaveCount(0);
  const territoryId = (await instruction.textContent())?.match(/durch (G\d+)/)?.[1];
  if (!territoryId) throw new Error("Das Zielgebiet der Kriegsteilung fehlt.");
  const targetCells = await map.locator(`rect.map-cell[data-territory-id="${territoryId}"]`).evaluateAll((elements) =>
    elements.map((cell) => Number(cell.getAttribute("y"))));
  const minimumY = Math.min(...targetCells);
  const maximumY = Math.max(...targetCells);

  await drawWarSplitBoundary(page, map, territoryId, minimumY, minimumY + 1);
  await expect(page.getByText("Die gezeichnete Grenze muss das Gebiet in genau zwei Teile trennen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Grenze übernehmen" })).toBeDisabled();
  await page.getByRole("button", { name: "Grenze neu zeichnen" }).click();

  await drawWarSplitBoundary(page, map, territoryId, minimumY, maximumY + 1);
  await expect(page.getByText("Vorschau: Beide Teile sind legal. Übernimm die Grenze für die Feinjustierung.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Grenze übernehmen" })).toBeEnabled();
  await page.getByRole("button", { name: "Grenze übernehmen" }).click();
  await expect(page.getByText(/Feinjustierung: Klicke einzelne Kästchen/)).toBeVisible();

  const selectedCells = map.locator("rect.map-cell-part-a");
  const selectedCount = await selectedCells.count();
  await selectedCells.first().click();
  await expect.poll(() => selectedCells.count()).toBe(selectedCount - 1);
  await expect(page.getByRole("button", { name: "Teilung bestätigen" })).toBeDisabled();
  await map.locator("rect.map-cell-part-b").first().click();
  await expect(page.getByRole("button", { name: "Teilung bestätigen" })).toBeEnabled();
  await page.getByRole("button", { name: "Teilung bestätigen" }).click();
  await expect(page.getByText(/wählt den Teil, den er behält/)).toBeVisible();
});

test("the border editor shows direct and automatic transfer previews", async ({ page }) => {
  await openWithoutIntroduction(page, "/?developer=1");
  await page.getByRole("button", { name: "Debug-Szenarien" }).click();
  await page.getByRole("button", { name: "Krieg · Grenzgewinn" }).click();
  await expect(page.getByText("♠-Bonus verfügbar")).toHaveCount(0);

  await expect(page.getByRole("heading", { name: /Grenze verschieben/ })).toBeVisible();
  await expect(page.getByText(/Direkter Grenzgewinn:/)).toBeVisible();
  await expect(page.getByText(/Abgeschnittenes Land:/)).toBeVisible();
  await expect(page.getByText(/Gesamtübernahme:/)).toBeVisible();
});
