# Multiplayer Server

Der Node-TypeScript-Server hält autoritative In-Memory-Rooms und stellt HTTP-Room-Endpunkte sowie `/ws` bereit. Start im Repository-Stamm: `npm run dev:server` oder zusammen mit dem Browser `npm run dev:multiplayer`.

`PORT` setzt den Port (Standard `3001`); `WEB_ORIGIN` erlaubt eine kommagetrennte Liste zusätzlicher Browser-Origins. Rooms und Sessions bestehen nur bis zum Neustart des Serverprozesses.
