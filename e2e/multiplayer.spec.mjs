import { expect, test } from "@playwright/test";

let accountNumber = 0;

async function openWithoutIntroduction(page, path = "/") {
  await page.addInitScript(() => localStorage.setItem("vedras-reiche-tutorial-progress", JSON.stringify({ introductionSeen: true, seen: {} })));
  await page.goto(path);
}

async function registerAccount(page, displayName) {
  const multiplayerButton = page.getByRole("button", { name: "Mehrspieler" });
  if (await multiplayerButton.isVisible().catch(() => false)) await multiplayerButton.click();
  await expect(page.getByLabel("Benutzername")).toBeVisible();
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  const username = `${displayName.toLowerCase()}-e2e-${Date.now().toString(36)}-${++accountNumber}`;
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Anzeigename").fill(displayName);
  await page.getByLabel("Passwort", { exact: true }).fill("ein-sicheres-passwort");
  await page.getByLabel("Passwort bestätigen").fill("ein-sicheres-passwort");
  await page.getByRole("button", { name: "Registrieren" }).click();
  await expect(page.getByText(`Angemeldet als ${displayName}`)).toBeVisible();
}

async function drawVerticalSetupBoundary(page, cut) {
  const map = page.getByRole("img", { name: "Vedras Rasterkarte" });
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  if (box === null) throw new Error("Rasterkarte hat keine Bildschirmgeometrie.");
  const size = Math.min(box.width, box.height);
  const left = box.x + (box.width - size) / 2;
  const top = box.y + (box.height - size) / 2;
  const x = left + size * cut / 50;
  await page.mouse.move(x, top + 2);
  await page.mouse.down();
  for (let step = 1; step <= 16; step += 1) await page.mouse.move(x, top + size * step / 16 - 2);
  await page.mouse.up();
  await page.getByRole("button", { name: "Teilung bestätigen" }).click();
}

test("two accounts create, join and start an authoritative room", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await openWithoutIntroduction(host);
    await registerAccount(host, "Anna");
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
    await registerAccount(guest, "Ben");
    await guest.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(guest.getByText(`Raum ${roomCode}`)).toBeVisible();
    await expect(host.getByText(/2\. Ben/)).toBeVisible();

    await host.getByRole("button", { name: "Spiel starten" }).click();
    const map = host.getByRole("img", { name: "Vedras Rasterkarte" });
    await expect(map).toBeVisible();
    await expect(guest.getByRole("img", { name: "Vedras Rasterkarte" })).toBeVisible();
    await expect(host.getByRole("heading", { name: "Gebiete: 1 / 12" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Gebiete: 1 / 12" })).toBeVisible();
    await expect(host.locator(".game-header .room-status")).toContainText(roomCode);
    await expect(host.getByRole("button", { name: "Regelhilfe öffnen" })).toBeVisible();
    await host.locator(".party-menu > summary").click();
    await expect(host.getByLabel("Spieler im Raum")).toContainText("Ben · ● verbunden");
    await host.locator(".party-menu > summary").click();
    await host.locator(".music-menu > summary").click();
    await guest.locator(".music-menu > summary").click();
    const hostTrack = host.getByText(/^Synchron im Raum:/);
    const guestTrack = guest.getByText(/^Synchron im Raum:/);
    await expect(hostTrack).toBeVisible();
    await expect(guestTrack).toBeVisible();
    expect(await hostTrack.textContent()).toEqual(await guestTrack.textContent());
    await guest.getByLabel("Hintergrundmusik").uncheck();
    await expect(guest.getByLabel("Hintergrundmusik")).not.toBeChecked();
    await guest.getByLabel("Hintergrundmusik").check();
    await expect(guestTrack).toHaveText(await hostTrack.textContent());
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("four players complete four drawing turns before the first POI phase begins", async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1600, height: 1200 } })));
  const [host, ben, clara, dora] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await openWithoutIntroduction(host);
    await registerAccount(host, "Anna");
    await host.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomCode = (await host.locator(".room-code strong").last().textContent())?.trim();
    if (!roomCode) throw new Error("Kein Raumcode sichtbar.");

    for (const [page, name] of [[ben, "Ben"], [clara, "Clara"], [dora, "Dora"]]) {
      await openWithoutIntroduction(page, `/?room=${roomCode}`);
      await registerAccount(page, name);
      await page.getByRole("button", { name: "Raum beitreten" }).click();
      await expect(page.getByText(`Raum ${roomCode}`)).toBeVisible();
    }

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await Promise.all([host, ben, clara, dora].map((page) => expect(page.getByRole("img", { name: "Vedras Rasterkarte" })).toBeVisible()));

    await drawVerticalSetupBoundary(host, 10);
    await Promise.all([host, ben, clara, dora].map((page) => expect(page.getByRole("region", { name: "Kartenbau" })).toContainText("Aktiver Spieler: Ben")));
    await expect(host.getByRole("button", { name: "Grenzstift" })).toBeDisabled();
    await expect(clara.getByRole("button", { name: "Grenzstift" })).toBeDisabled();
    await expect(ben.getByRole("button", { name: "Grenzstift" })).not.toBeDisabled();

    for (const [page, cut, regionCount] of [[ben, 20, 3], [clara, 30, 4]]) {
      await drawVerticalSetupBoundary(page, cut);
      await expect(page.getByText(`Gebiete: ${regionCount} / 20`)).toBeVisible();
    }

    await expect(dora.getByRole("region", { name: "Kartenbau" })).toContainText("Aktiver Spieler: Dora");
    await expect(dora.getByText("Wahrzeichen platzieren")).toHaveCount(0);
    await drawVerticalSetupBoundary(dora, 40);
    await expect(dora.getByRole("region", { name: "Strategische Punkte platzieren" })).toBeVisible();
    await expect(dora.getByText("Wahrzeichen platzieren")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("account rooms can be found after clearing local storage without persisting a room token", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await openWithoutIntroduction(page);
    await registerAccount(page, "Anna");
    await page.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomA = (await page.locator(".room-code strong").last().textContent())?.trim();
    if (!roomA) throw new Error("Kein erster Raumcode sichtbar.");
    await page.getByRole("button", { name: "Zu gespeicherten Partien" }).click();

    await page.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomB = (await page.locator(".room-code strong").last().textContent())?.trim();
    if (!roomB || roomA === roomB) throw new Error("Kein zweiter, eigener Raumcode sichtbar.");
    await page.getByRole("button", { name: "Zu gespeicherten Partien" }).click();

    const accountRooms = page.getByRole("region", { name: "Meine Partien" });
    await expect(accountRooms.getByText(`Raum ${roomA}`)).toBeVisible();
    await expect(accountRooms.getByText(`Raum ${roomB}`)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("vedras-reiche-multiplayer-sessions") ?? "")).not.toContain("sessionToken");

    await page.evaluate(() => localStorage.removeItem("vedras-reiche-multiplayer-sessions"));
    await page.reload();
    await page.getByRole("button", { name: "Mehrspieler" }).click();
    await expect(page.getByText("Angemeldet als Anna")).toBeVisible();
    const restoredAccountRooms = page.getByRole("region", { name: "Meine Partien" });
    await expect(restoredAccountRooms.getByText(`Raum ${roomA}`)).toBeVisible();
    await restoredAccountRooms.locator("article").filter({ hasText: `Raum ${roomA}` }).getByRole("button", { name: "Fortsetzen" }).click();
    await expect(page.locator(".room-code strong").last()).toHaveText(roomA);
  } finally {
    await context.close();
  }
});

test("a second tab resumes one account participant and closes the old connection", async ({ page: first, context }) => {
  const second = await context.newPage();
  await openWithoutIntroduction(first);
  await registerAccount(first, "Anna");
  await first.getByRole("button", { name: "Neues Spiel erstellen" }).click();
  const roomCode = (await first.locator(".room-code strong").last().textContent())?.trim();
  if (!roomCode) throw new Error("Kein Raumcode sichtbar.");

  await openWithoutIntroduction(second);
  const multiplayerButton = second.getByRole("button", { name: "Mehrspieler" });
  if (await multiplayerButton.isVisible().catch(() => false)) await multiplayerButton.click();
  const accountRooms = second.getByRole("region", { name: "Meine Partien" });
  await expect(accountRooms.getByText(`Raum ${roomCode}`)).toBeVisible();
  await accountRooms.getByRole("button", { name: "Fortsetzen" }).click();
  await expect(second.locator(".room-code strong").last()).toHaveText(roomCode);
  await expect(first.getByRole("status")).toContainText("Diese Spielersitzung wurde in einem anderen Fenster geöffnet.");
  await expect(second.locator(".lobby-player")).toHaveCount(1);
});

test("a host can remove a waiting guest and the guest receives a terminal status", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await openWithoutIntroduction(host);
    await registerAccount(host, "Anna");
    await host.getByRole("button", { name: "Neues Spiel erstellen" }).click();
    const roomCode = (await host.locator(".room-code strong").last().textContent())?.trim();
    if (!roomCode) throw new Error("Kein Raumcode sichtbar.");
    await openWithoutIntroduction(guest, `/?room=${roomCode}`);
    await registerAccount(guest, "Ben");
    await expect(guest.getByLabel("Raumcode")).toHaveValue(roomCode);
    await guest.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(host.getByText(/2\. Ben/)).toBeVisible();

    host.once("dialog", (dialog) => dialog.accept());
    await host.locator(".lobby-player").filter({ hasText: "Ben" }).getByRole("button", { name: "Entfernen" }).click();
    await expect(host.getByText(/Ben wurde aus der Lobby entfernt/)).toBeVisible();
    await expect(guest.getByText("Du wurdest aus diesem Raum entfernt.")).toBeVisible();
    await expect(host.locator(".lobby-player").filter({ hasText: "Ben" })).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
