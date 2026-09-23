import { expect, test } from "@playwright/test";

async function openWithoutIntroduction(page, path = "/") {
  await page.addInitScript(() => localStorage.setItem("vedras-reiche-tutorial-progress", JSON.stringify({ introductionSeen: true, seen: {} })));
  await page.goto(path);
}

test("two browsers create, join and start an authoritative room", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await openWithoutIntroduction(host);
    await host.getByRole("button", { name: "Mehrspieler" }).click();
    await host.getByLabel("Name").fill("Anna");
    await host.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    await expect(host.locator(".room-code strong").last()).toHaveText(/[A-Z0-9]+/);
    const roomCode = (await host.locator(".room-code strong").last().textContent())?.trim();
    if (!roomCode) throw new Error("Kein Raumcode sichtbar.");

    await openWithoutIntroduction(guest, `/?room=${roomCode}`);
    await guest.getByLabel("Name").fill("Ben");
    await guest.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(guest.getByText(`Raum ${roomCode}`)).toBeVisible();
    await expect(host.getByText(/2\. Ben/)).toBeVisible();

    await host.getByRole("button", { name: "Spiel starten" }).click();
    const map = host.getByRole("img", { name: "Vedras Rasterkarte" });
    await expect(map).toBeVisible();
    await expect(guest.getByRole("img", { name: "Vedras Rasterkarte" })).toBeVisible();
    const box = await map.boundingBox();
    if (box === null) throw new Error("Rasterkarte hat keine Bildschirmgeometrie.");
    const x = box.x + box.width / 2;
    await host.mouse.move(x, box.y + 2);
    await host.mouse.down();
    for (let step = 1; step <= 12; step += 1) await host.mouse.move(x, box.y + box.height * step / 12);
    await host.mouse.up();
    await host.getByRole("button", { name: "Teilung bestätigen" }).click();
    await expect(host.getByText("2 Regionen", { exact: true })).toBeVisible();
    await expect(guest.getByText("2 Regionen", { exact: true })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
