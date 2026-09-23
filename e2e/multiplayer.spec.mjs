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
    await hostContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5174" });
    await host.getByRole("button", { name: "Einladungslink kopieren" }).click();
    const inviteLink = await host.evaluate(() => navigator.clipboard.readText());
    expect(inviteLink).toContain(`?room=${roomCode}`);
    expect(inviteLink).not.toContain("sessionToken");

    await openWithoutIntroduction(guest, `/?room=${roomCode}`);
    await guest.getByLabel("Name").fill("Ben");
    await guest.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(guest.getByText(`Raum ${roomCode}`)).toBeVisible();
    await expect(host.getByText(/2\. Ben/)).toBeVisible();

    await host.getByRole("button", { name: "Spiel starten" }).click();
    const map = host.getByRole("img", { name: "Vedras Rasterkarte" });
    await expect(map).toBeVisible();
    await expect(guest.getByRole("img", { name: "Vedras Rasterkarte" })).toBeVisible();
    await expect(host.getByText("1 Regionen", { exact: true })).toBeVisible();
    await expect(guest.getByText("1 Regionen", { exact: true })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("saved rooms can be resumed individually and forgotten only in this browser", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await openWithoutIntroduction(page);
    await page.getByRole("button", { name: "Mehrspieler" }).click();
    await page.getByLabel("Name").fill("Anna");
    await page.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomA = (await page.locator(".room-code strong").last().textContent())?.trim();
    if (!roomA) throw new Error("Kein erster Raumcode sichtbar.");
    await page.getByRole("button", { name: "Zu gespeicherten Partien" }).click();

    await page.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomB = (await page.locator(".room-code strong").last().textContent())?.trim();
    if (!roomB || roomA === roomB) throw new Error("Kein zweiter, eigener Raumcode sichtbar.");
    await page.getByRole("button", { name: "Zu gespeicherten Partien" }).click();

    const savedA = page.locator("article").filter({ hasText: `Raum ${roomA}` });
    const savedB = page.locator("article").filter({ hasText: `Raum ${roomB}` });
    await expect(savedA).toBeVisible();
    await expect(savedB).toBeVisible();
    await savedA.getByRole("button", { name: "Fortsetzen" }).click();
    await expect(page.getByText(`Raum ${roomA}`)).toBeVisible();
    await page.getByRole("button", { name: "Zu gespeicherten Partien" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await savedA.getByRole("button", { name: "Lokal vergessen" }).click();
    await expect(savedA).toHaveCount(0);
    await expect(savedB).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a host can remove a waiting guest and the guest receives a terminal status", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
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
    await expect(guest.getByLabel("Raumcode")).toHaveValue(roomCode);
    await guest.getByLabel("Name").fill("Ben");
    await guest.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(host.getByText(/2\. Ben/)).toBeVisible();

    await host.locator(".lobby-player").filter({ hasText: "Ben" }).getByRole("button", { name: "Entfernen" }).click();
    await expect(host.getByText(/Ben wurde aus der Lobby entfernt/)).toBeVisible();
    await expect(guest.getByText("Du wurdest aus diesem Raum entfernt.")).toBeVisible();
    await expect(host.locator(".lobby-player").filter({ hasText: "Ben" })).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
