# Betrieb und Deployment

## Architektur

Eine Vedras-Reiche-Instanz besteht aus einem Node-Prozess und einem persistenten Datenvolume. Ein HTTPS-fähiger Reverse Proxy oder die Hosting-Plattform terminiert TLS und leitet HTTP sowie WebSocket-Upgrades an denselben internen Node-Port weiter.

```text
Browser ── HTTPS / WSS ──> Reverse Proxy ── HTTP / WebSocket ──> Vedras Server
                                                                  ├── / (Webbuild)
                                                                  ├── /api
                                                                  ├── /ws
                                                                  └── /data/rooms
```

Der Node-Server liefert den Vite-Production-Build aus. `/api`, `/ws`, `/health` und `/data` sind vom SPA-Fallback ausgeschlossen. Der Client verwendet für API und WebSocket denselben Browser-Origin; HTTPS ergibt dabei automatisch WSS.

## Production-Build und Start

Node.js 20 oder neuer ist erforderlich. Der Production-Start erwartet einen gesetzten öffentlichen Origin:

```sh
npm ci
npm run build:production
WEB_ORIGIN=https://staging.example.invalid VEDRAS_DATA_DIR=/srv/vedras-data npm start
```

In PowerShell werden die Variablen vor dem Start gesetzt:

```powershell
$env:WEB_ORIGIN = "https://staging.example.invalid"
$env:VEDRAS_DATA_DIR = "C:\vedras-data"
npm start
```

`npm start` startet ausschließlich bereits gebautes JavaScript. Es kompiliert kein TypeScript. Die Startprüfung erstellt und beschreibt das Room-Verzeichnis und lädt vorhandene Snapshots; bei einem Storage- oder fehlenden Webbuild-Fehler beendet sich der Prozess statt scheinbar gesund zu starten.

| Variable | Zweck | Beispiel |
| --- | --- | --- |
| `PORT` | interner HTTP-Port | `3000` |
| `VEDRAS_DATA_DIR` | Wurzel des persistenten Storage | `/data` |
| `WEB_ORIGIN` | exakt erlaubter öffentlicher Browser-Origin, ohne Slash | `https://staging.example.invalid` |
| `NODE_ENV` | aktiviert Production-Header und Static Serving | `production` |
| `VEDRAS_WEB_DIST` | optionaler Pfad zum Webbuild | `/app/apps/web/dist` |
| `VEDRAS_BUILD_ID` | optionale öffentliche Build-Kennung | Git-Commit-SHA |

`WEB_ORIGIN` kann mehrere kommagetrennte, vollständige Origins enthalten. In Production ist keine CORS-Wildcard aktiv. `.env.example` enthält nur Beispielwerte; echte Zugangsdaten und Hostersecrets gehören in die Secret-Verwaltung des Betreibers.

## Docker

Das Repository enthält einen mehrstufigen, nicht als root laufenden Production-Container. Build und Start mit einem benannten Volume:

```sh
docker build --build-arg VEDRAS_BUILD_ID=$(git rev-parse --short HEAD) -t vedras-reiche:staging .
docker volume create vedras-rooms
docker run --rm -p 3000:3000 -v vedras-rooms:/data \
  -e WEB_ORIGIN=https://staging.example.invalid \
  -e VEDRAS_DATA_DIR=/data \
  vedras-reiche:staging
```

Der Container stellt Port `3000` intern bereit und enthält einen Healthcheck für `/health`. Der Reverse Proxy veröffentlicht ausschließlich HTTPS auf Port 443 und muss HTTP-Upgrades für `/ws` durchreichen. Er setzt den externen Host unverändert durch. TLS-Zertifikate liegen beim Proxy oder bei der Hosting-Plattform, nicht im Node-Container.

## Health, Logs und Shutdown

`GET /health` antwortet im gesunden Zustand mit HTTP 200 und:

```json
{"status":"ok","storage":"ok","protocolVersion":1}
```

Bei einer während des Betriebs fehlgeschlagenen Speicherung antwortet der Endpoint mit 503. Provider-Logs und ein regelmäßiger externer Aufruf von `/health` reichen für die erste Staging-Instanz als Beobachtung aus. Logs sind JSON-Ereignisse und enthalten keine Session-Tokens, Token-Hashes, verdeckten Entscheidungen oder vollständigen Spielzustände.

Bei `SIGTERM` oder `SIGINT` nimmt der Server keine neuen Anfragen oder WebSocket-Upgrades mehr an, schließt WebSockets und beendet anschließend den HTTP-Server. Bestätigte Room-Änderungen sind davor bereits atomar gespeichert.

## Persistenz, Updates, Rollback und Backup

`VEDRAS_DATA_DIR` muss außerhalb des flüchtigen Container-Dateisystems liegen. Die Dateien unter `rooms/` sind die autoritativen Snapshots für WAITING-, RUNNING- und FINISHED-Rooms und enthalten nur Token-Hashes, nie Raw Session-Tokens. `matches/` enthält die unveränderlichen, versionierten Matchzusammenfassungen für Konto-Historien und Statistiken. Ein Neustart mit demselben Volume stellt Rooms, Revision und Spieleridentität wieder her; Browser verbinden sich mit ihrer lokalen Session erneut und der Server ergänzt gegebenenfalls fehlende Matchzusammenfassungen aus sicher auswertbaren FINISHED-Räumen.

Vor einem Update zuerst die GitHub-CI abwarten. Danach ein neues Image bauen, denselben Volume-Mount verwenden und den Container geordnet ersetzen. Für ein Rollback wird das vorherige Image oder Commit mit demselben Volume wieder gestartet. Das ist sicher, solange keine spätere inkompatible `persistenceVersion` eingeführt wurde; bei einer solchen Änderung braucht es vorab einen getesteten Migrations- oder Wiederherstellungsplan.

Für die erste Freundesrunde genügt ein regelmäßiger Provider-Volume-Snapshot oder eine ausgeschaltete Dateikopie des gesamten Datenverzeichnisses. Vor einem Wiederherstellen den aktuellen Volume-Inhalt sichern und die Wiederherstellung zunächst auf einer Staging-Instanz prüfen.

## Staging-Checkliste

Nach erfolgreicher CI auf einer echten HTTPS-Staging-Domain prüfen:

1. `/health` liefert 200 und `storage: "ok"`.
2. Zwei Browser erstellen, betreten und starten einen Room über den Invite-Link.
3. Eine Karten- und eine Spielaktion synchronisieren; fremde Fraktionen, Gebote und ♠-Auswahlen bleiben verborgen.
4. Browser neu laden und die gespeicherte Session wieder verbinden.
5. Container mit demselben Volume neu starten und Room, Revision und Reconnect prüfen.
6. `/data/rooms/...` und Traversal-Pfade liefern keinen Inhalt aus.

Für die erste öffentliche Instanz gibt es noch keine providerspezifische Anleitung, da dieses Repository keinen Hosting-Account, keine Domain und keine Deployment-Secrets enthält.
