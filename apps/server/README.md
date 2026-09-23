# Multiplayer Server

Der Node-TypeScript-Server hält autoritative In-Memory-Rooms und stellt HTTP-Room-Endpunkte sowie `/ws` bereit. Start im Repository-Stamm: `npm run dev:server` oder zusammen mit dem Browser `npm run dev:multiplayer`.

`PORT` setzt den Port (Standard `3001`); `WEB_ORIGIN` erlaubt eine kommagetrennte Liste exakter Browser-Origins. `VEDRAS_DATA_DIR` legt das persistente Room-Verzeichnis fest. Beim Start lädt der `FileRoomStore` WAITING-, RUNNING- und FINISHED-Rooms wieder; auf Disk liegen nur Session-Token-Hashes.

Für Production startet der gebaute Server über `npm start` und liefert den Vite-Webbuild unter demselben Origin wie `/api` und `/ws` aus. Die Betriebsanleitung steht in [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).
