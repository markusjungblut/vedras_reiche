import { expect, test } from "@playwright/test";

async function openWithoutIntroduction(page, path = "/") {
  await page.addInitScript(() => localStorage.setItem("vedras-reiche-tutorial-progress", JSON.stringify({ introductionSeen: true, seen: {} })));
  await page.goto(path);
}

test("local map creation, labels, zoom and pan use the live SVG map", async ({ page }) => {
  await openWithoutIntroduction(page);
  await expect(page.getByRole("button", { name: "Debug-Szenarien" })).toHaveCount(0);
  await page.getByRole("button", { name: "Lokales Testspiel" }).click();
  await page.getByRole("button", { name: "Kartenbau starten" }).click();

  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await expect(map).toBeVisible();
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
