import { expect, test } from "@playwright/test";

async function openWithoutIntroduction(page, path = "/") {
  await page.addInitScript(() => localStorage.setItem("vedras-reiche-tutorial-progress", JSON.stringify({ introductionSeen: true, seen: {} })));
  await page.goto(path);
}

test("the entry screen remains usable from desktop to phone", async ({ browser }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await openWithoutIntroduction(page);
      await expect(page.getByRole("button", { name: "Mehrspieler" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Lokales Testspiel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Debug-Szenarien" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      await page.getByRole("button", { name: "Mehrspieler" }).click();
      await expect(page.getByLabel("Name")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    } finally {
      await context.close();
    }
  }
});

test("sound preference is persisted and reduced motion is honored", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWithoutIntroduction(page);
    const soundToggle = page.getByRole("button", { name: "🔊 Sound an" });
    await expect(soundToggle).toHaveAttribute("aria-pressed", "true");
    await soundToggle.click();
    await expect(page.getByRole("button", { name: "🔇 Sound aus" })).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(page.getByRole("button", { name: "🔇 Sound aus" })).toHaveAttribute("aria-pressed", "false");
    const transitionDuration = await page.locator(".primary-button").evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
  } finally {
    await context.close();
  }
});

test("phone layout keeps help available and dismissible by keyboard", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await openWithoutIntroduction(page);
    await page.getByRole("button", { name: "Lokales Testspiel" }).click();
    await page.getByRole("button", { name: "Kartenbau starten" }).click();
    await expect(page.getByRole("img", { name: "Vedras Rasterkarte" })).toBeVisible();
    await page.getByRole("button", { name: "Regelhilfe öffnen" }).click();
    const help = page.getByRole("dialog", { name: "? Hilfe" });
    await expect(help).toBeVisible();
    expect(await help.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a 100 by 100 board remains interactive after the authoritative start", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const guestContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await openWithoutIntroduction(host);
    await host.getByRole("button", { name: "Mehrspieler" }).click();
    await host.getByLabel("Name").fill("Anna");
    await host.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomCode = (await host.locator(".room-code strong").last().textContent())?.trim();
    if (!roomCode) throw new Error("Kein Raumcode sichtbar.");
    await openWithoutIntroduction(guest, `/?room=${roomCode}`);
    await guest.getByLabel("Name").fill("Ben");
    await guest.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(host.getByText(/2\. Ben/)).toBeVisible();

    await host.getByRole("button", { name: "100 × 100" }).click();
    await expect(host.getByText(/Aktuelle Karte: 100 × 100/)).toBeVisible();
    await host.getByRole("button", { name: "Spiel starten" }).click();
    const map = host.getByRole("img", { name: "Vedras Rasterkarte" });
    await expect(map).toBeVisible();
    await expect(guest.getByRole("img", { name: "Vedras Rasterkarte" })).toBeVisible();
    await expect(host.locator(".map-cell")).toHaveCount(10_000);
    await map.hover();
    await host.mouse.wheel(0, -120);
    await expect(host.locator(".map-legend")).toContainText("116 %");
    const viewBeforePan = await map.getAttribute("viewBox");
    const mapBox = await map.boundingBox();
    if (mapBox === null) throw new Error("Die große Rasterkarte hat keine Bildschirmgeometrie.");
    await host.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await host.mouse.down({ button: "middle" });
    await host.mouse.move(mapBox.x + mapBox.width / 2 + 36, mapBox.y + mapBox.height / 2);
    await host.mouse.up({ button: "middle" });
    await expect(map).not.toHaveAttribute("viewBox", viewBeforePan ?? "");
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
