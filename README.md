# Vedras Reiche

Dieses Repository enthält den Game Core, einen lokalen Pass-and-Play-Client und einen autoritativen Multiplayer-Server für eine digitale Version von **Vedras Reiche**. Der Server verwaltet gemeinsame Partien für zwei bis sechs Browser.

Die [ausführliche Spielanleitung](docs/rules/Vedras%20Reiche.docx) ist die maßgebliche Regelquelle. Nicht eindeutig belegte Regeln werden nicht ergänzt; tatsächlich offene Punkte stehen in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

## Architektur

```text
Lokaler Debug-Client → @vedras/game-core

Mehrspieler-Client → WebSocket/Protocol → Server → @vedras/game-core
```

Der direkte Core-Aufruf im Browser dient ausschließlich der lokalen Entwicklung mit mehreren Spielern an einem Fenster. Im Mehrspielermodus hält allein der Server den vollständigen Spielzustand. Browser senden Aktionen und erhalten nur ihre eigene, vom Core redigierte Spieleransicht. Die Zuständigkeiten und Zustandsübergänge stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); die visuellen Leitlinien in [docs/UI.md](docs/UI.md).

## Projektstruktur

```text
apps/
  web/               React/Vite Visual Debug Client und Demo-Szenarien
  server/            Node/WebSocket-Server für autoritative Rooms
packages/
  game-core/
    src/             Modelle, Aktionen, Ereignisse, Regeln und Zustand
    tests/           automatisierte Core-Tests
  protocol/          versionierte Transport-DTOs ohne Spiellogik
docs/
  ARCHITECTURE.md
  UI.md
OPEN_QUESTIONS.md
```

Das Repository verwendet npm Workspaces und TypeScript im Strict Mode.

## Spielaufbau

`Neues Spiel` startet eine vollständige lokale Partie ohne Debug-Fixture: Zwei bis sechs Namen werden in ihre dauerhafte Sitzreihenfolge gebracht und der erste Kartenzeichner bestimmt. Die lokale Vorgabe ist `50 × 50` Zellen; im Mehrspielerraum legt der Host Breite und Höhe vor dem Start fest. Jede Zelle gehört im `MAP_CREATION`-Zustand sofort zur einzigen temporären Setup-Region. Spieler zeichnen Grenzen auf Rasterkanten. Ein normaler Entwurf darf mit mehreren Strichen genau eine bestehende Region in zwei Regionen teilen. Die Mindestfläche beträgt `ceil(Breite × Höhe × 1 %)`, also auf der Standardkarte 25 Zellen. Korrekturen sind ausschließlich vor dem Kartenabschluss erlaubt und erhalten die Regionszahl.

Nach `P`, `2P`, `3P` und `4P` erkannten Setup-Regionen unterbricht der Core den Zeichenablauf für die vorgeschriebenen Wahrzeichen, Knotenpunkte, Festungen und Relikte. Derselbe Zugzeiger läuft während aller Zeichen- und POI-Schritte weiter. POIs können auf jeder freien Rasterzelle stehen und bleiben bei späteren Teilungen zellgebunden. Finalisiert wird erst bei `4 × Spielerzahl + 4` Regionen, vollständiger POI-Tabelle und wenn jede endgültige Region Mindestfläche, orthogonalen Zusammenhang und mindestens zwei Seiten-Nachbarn besitzt. Die Karte muss als Gesamtheit nicht zusammenhängen.

Erst danach zieht der Core aus den 48 gedruckten Karten gleich viele Karten pro Symbol, mischt sie und verteilt sie auf die neutralen Anfangsgebiete. Geheime Fraktionen werden per `RandomSource` in Sitzreihenfolge vergeben und im lokalen Client einzeln hinter einer Pass-and-Play-Ansicht gezeigt. Der gespeicherte letzte Kartenzeichner bestimmt den ersten Auktionssteller der vorhandenen Startauktionen.

Die Papierwerte A4 und A5 bleiben in der Spielanleitung erhalten, gehören aber nicht zum normalen digitalen Spielpfad.

## Startauktionen

Vor Runde 1 finden zwei Startauktionsrunden statt. Jede legt mit der eingespeisten `RandomSource` `Spielerzahl + 1` neutrale Gebiete in zufälliger, anschließend fester Reihenfolge aus. Die zweite Auslage enthält keine Gebiete der ersten, auch wenn diese neutral geblieben sind. Das nächste noch neutrale Gebiet der Auslage wird versteigert; nach dem letzten Gebiet beginnt ein weiterer Durchlauf durch dieselbe Auslage. Der Auktionssteller wandert nach jeder einzelnen Auktion im Uhrzeigersinn. Er wählt das Gebiet nicht aus.

In jeder Startauktionsrunde erhält jeder Spieler die Gebote `0` bis `Spielerzahl`. Nur Spieler ohne Gebiet aus dieser Runde bieten mit. Jedes aufgedeckte Gebot wird verbraucht, auch die `0` und auch bei einem verlorenen Gebot. Ein Spieler ohne Gebiet erhält sofort einen neuen vollständigen Satz, wenn sein Satz aufgebraucht ist. Ein eindeutiger Höchstbietender erhält das Gebiet und scheidet für diese Startauktionsrunde aus. Bei lauter Nullen oder mindestens drei Höchstbietenden bleibt das Gebiet neutral. Genau zwei Höchstbietende führen zur zweistufigen, im Core geometrisch geprüften Gebietsteilung: Einer zieht die Grenze, der andere wählt zuerst. Nach zwei vollständig abgeschlossenen Runden besitzt jeder Spieler zwei Gebiete; für das reguläre Spiel stehen sechs globale Einflusspunkte und die Grundgebote `1`, `2`, `3` bereit.

## Runden und Aktivierungen

Eine Runde beginnt mit der Aktivierungsphase und geht danach in die Aktionsphase über. Der erste Startspieler wird über die eingespeiste `RandomSource` bestimmt. Nach jeder vollständig abgeschlossenen Runde wandert diese Rolle in der festgelegten Spielerreihenfolge im Uhrzeigersinn weiter. Der Zustand hält die aktuelle Runde und die für die Spielerzahl geltende Höchstzahl fest.

Zu Beginn der Aktivierungsphase entstehen genau drei verschiedene Zahlen zwischen 1 und 12. Jede Zahl wird mit zwei W6 bestimmt: Der erste Würfel wählt eines der Paare `1/2` bis `11/12`; der zweite wählt bei `1–3` die niedrigere und bei `4–6` die höhere Zahl. Doppelte Ergebnisse werden neu gewürfelt. Der Core verwendet dafür kein direktes `Math.random()`, sodass Tests die Würfelfolge genau vorgeben können.

Alle kontrollierten Gebiete mit mindestens einer passenden Aktivierungszahl werden je einmal aktiviert; neutrale Gebiete bleiben aus. Die Spieler sind vom Startspieler aus im Uhrzeigersinn an der Reihe. Hat ein Spieler mehrere offene Gebiete, wählt er deren Reihenfolge selbst durch einzelne Aktivierungsaktionen. Jede Aktion enthält die nötige Symbol- und Zielwahl. Nach einem gültigen Effekt wird das Gebiet als abgehandelt markiert. Spieler ohne offene Gebiete werden übersprungen. Sobald alle Aktivierungen erledigt sind, wechselt der Zustand in die Aktionsphase.

Die offenen Aktivierungen werden zu Beginn der Phase ermittelt. Erhält ein Gebiet währenddessen durch ♣ eine zweite Zahl, kann diese erst ab der nächsten Runde eine Aktivierung auslösen.

| Symbol | Wirkung in Arbeitspaket 2 |
| --- | --- |
| ♦ Karo | Eine Grenze zu einem angrenzenden gegnerischen Gebiet kann für den nächsten Krieg markiert werden. Eine Grenze zu einem neutralen Nachbarn kann bis zur für die Kartengröße gültigen Tiefe geometrisch verschoben werden. Die Aktivierung wartet auf diese Entscheidung. |
| ♣ Kreuz | Eigenes Gebiet oder eigener Nachbar erhält bei einer Aktivierung eine Siedlung, wird zur Stadt entwickelt oder erhält eine Spezialisierung. Zweite Aktivierungszahl und zweites Symbol schließen sich gegenseitig aus; Siedlung oder Stadt kann daneben bestehen. |
| ♥ Herz | Wahl zwischen genau einem globalen Einfluss oder zwei lokalen Einflusspunkten auf einem angrenzenden neutralen Gebiet. |
| ♠ Pik | Ein einmal verwendbarer Kampfbonus mit Spieler und Herkunftsgebiet wird für die laufende Runde gespeichert und verfällt ungenutzt am Rundenende. |

Nachbarschaften und Flächen werden aus der Rasterkarte berechnet. ♦-Grenzverschiebungen werden im Rastereditor geprüft und sofort angewendet.

## Aktionsphase und normale Auktionen

Die Aktionsphase beginnt beim Startspieler und läuft im Uhrzeigersinn. Jeder Spieler führt genau eine Grundaktion aus: Auktion oder Krieg. Der aktuelle Spieler kann eine Auktion für ein unmittelbar angrenzendes neutrales Gebiet eröffnen oder mit einem eigenen Gebiet einen angrenzenden Gegner angreifen. Nur wenn beides unmöglich ist, verfällt die Grundaktion. Ein Gebiet, das ein Spieler in der Auktion eines anderen gewinnt, verbraucht seine eigene Grundaktion nicht.

Bei einer normalen Auktion müssen alle Spieler verdeckt bieten, auch ohne Nachbarschaft zum Gebiet. Ein Gebot besteht aus einem verfügbaren Grundgebot `1`, `2` oder `3`, ganzzahligem globalem Einfluss und gegebenenfalls eigenem lokalem Einfluss auf dem versteigerten Gebiet. Der Core wertet erst aus, wenn alle Gebote vorliegen. Erfolgreiche Erwerber bezahlen Einfluss und erschöpfen ihr Grundgebot. Bei einem unaufgelösten Höchstgleichstand bleibt der Einfluss erhalten, aber die beteiligten Höchstbieter erschöpfen ihr verwendetes Grundgebot. Nach Erschöpfung aller drei Grundgebote steht sofort ein neuer vollständiger Satz zur Verfügung. Wird das Gebiet vergeben, verfällt sämtlicher dort verbliebener lokaler Einfluss.

Bei genau zwei Höchstbietenden bleibt die Auktion bis zur Entscheidung über eine legale Gebietsteilung offen. Ist diese nachweislich unmöglich, bleibt das Gebiet neutral, beide Höchstbieter erschöpfen ihr Grundgebot und niemand bezahlt Einfluss. Bei mindestens drei Höchstbietenden bleibt das Gebiet ebenfalls neutral; nur deren Höchstbieter erschöpfen ihr Grundgebot. Nach dem ersten solchen Gleichstand darf der aktive Spieler innerhalb derselben Grundaktion eine zweite Auktion eröffnen oder seinen Zug beenden. Eine dritte Auktion ist nicht möglich. Nach vollständig abgewickelter Aktion folgt der nächste Spieler. Erst nach der letzten Aktion ist die Runde abgeschlossen und kann die nächste beginnen; nach der letzten Spielrunde beginnt `SCORING`.

## Endwertung und Spielende

Die Endwertung leitet Fläche, Nachbarschaften sowie die aktuelle Zugehörigkeit von POIs und Entwicklungen aus der Rasterkarte ab. Sie rechnet Gebietspunkte exakt in Hundertstel: Grundfläche und alle Prozentboni werden additiv kombiniert. Der Core speichert für jedes kontrollierte Gebiet die einzelnen Bonusanteile und für jeden Spieler die Gesamtsumme.

Für das größte zusammenhängende Reich erhält eine eindeutige größte Komponente automatisch ihren Bonus. Bei mehreren gleich großen Komponenten wählt der betreffende Spieler eine davon. Sobald alle nötigen Entscheidungen vorliegen, erzeugt der Core ein unveränderliches `GameResult`, bestimmt alle punktgleichen Sieger und wechselt nach `FINISHED`. Weitere reguläre Aktionen sind dann gesperrt. Die Siegerehrung rundet nur die angezeigten Gesamtpunkte, ermittelt Platzierungen aber anhand der exakten Hundertstel und deckt alle Fraktionen auf.

Gebote liegen bis zur gemeinsamen Aufdeckung verdeckt im Game-Core-Zustand. `createGameViewForPlayer` entfernt vor Spielende gegnerische Gebotshöhen, geheime Fraktionssymbole und noch nicht gemeinsam ausgewertete gegnerische ♠-Entscheidungen. Bei `FINISHED` werden alle Fraktionen für die Siegerehrung öffentlich. Der Multiplayer-Server sendet ausschließlich diese serverseitig redigierte Spieleransicht an Clients.

## Lokaler Client und Debug-Szenarien

Der Browser-Client startet regulär mit `Neues Spiel` und führt über Kartenbau, POIs, Karten- und Fraktionsverteilung direkt in die Startauktionen. Rasterzellen, gemeinsame Kanten, Besitzerfarben, Karten-Symbole, Aktivierungszahlen und POIs werden aus `GameState.map` dargestellt. Der Grenzstift nutzt die SVG-Bildschirmtransformation, snappt auf Rastervertices und hält Entwurfskanten lokal. Der Radiergummi entfernt nur diese unbestätigten Kanten, Rückgängig entfernt den letzten vollständigen Strich. Beim Bestätigen übernimmt der Core nur Kanten, die die neue Regionengrenze bilden; offene Äste werden verworfen. Startauktionen, Aktivierungen und normale Auktionen lassen sich lokal als Pass-and-play bedienen.

Ein wählbarer Debug-Seed macht den Zufallsablauf bei gleichen Entscheidungen reproduzierbar. Schnellstarts für Gleichstand, Grenzgewinn, Vorstoß, Eroberung, Teilung, ♦, ♠ und Festungen führen die betreffenden Core-Aktionen aus. Die Demo-Rasterabmessung ist ausschließlich eine Fixture und keine neue Spielregel.

## Lokales Multiplayer-Spiel

Starte Server und Browser gemeinsam:

```sh
npm run dev:multiplayer
```

Öffne [http://localhost:5173](http://localhost:5173) in zwei Browser-Tabs. Im ersten Tab `Mehrspieler` wählen, einen Namen eingeben und `Spiel erstellen` wählen. Den angezeigten Raumcode im zweiten Tab zusammen mit einem Namen eingeben und `Raum beitreten` wählen. Der Host legt Sitzreihenfolge, Kartengröße und ersten Kartenzeichner fest und startet anschließend die Partie. Die Größe gehört zum öffentlichen Raumzustand und wird beim Start vom Server an den Core übergeben.

Der Browser speichert Room-ID, Spieler-ID, Session-Token, Namen und eine kleine, nicht autoritative Room-Zusammenfassung lokal. Die Mehrspieler-Startseite gruppiert damit wartende, laufende und beendete eigene Partien; `Fortsetzen` prüft anschließend wieder den Server. `Lokal vergessen` entfernt nur diese Browser-Sitzung und nie den Serverroom. Invite-Links enthalten ausschließlich den Roomcode, können kopiert oder über die Share-Funktion geteilt werden und füllen den Join-Bereich automatisch vor.

Der Host kann Gäste nur vor Spielstart aus der Lobby entfernen. Ein entfernter Browser erhält einen terminalen Hinweis und versucht keine erneute Verbindung. Nach einer beendeten Partie kann ihr Host ein Rematch erzeugen: Es entsteht ein neuer WAITING-Room mit gleicher Kartengröße, neuen Zugangsdaten und normalem Setup; die alte Ergebnispartie bleibt erhalten.

Der Server legt jeden Room als atomaren JSON-Snapshot unter `data/rooms/` ab; `data/` wird nicht committed. Beim Neustart lädt er WAITING-, RUNNING- und FINISHED-Rooms wieder ein. Zum Testen eines Neustarts `npm run dev:multiplayer` beenden, erneut starten und die gespeicherte Partie im Browser fortsetzen. `VEDRAS_DATA_DIR=/pfad/zum/volume` setzt das Datenverzeichnis; ohne Angabe gilt `./data`. Für andere Entwicklungs-Origins kann der Server mit `WEB_ORIGIN=http://host:port` gestartet werden; `PORT` setzt den Server-Port.

## Production und Staging

`npm run build:production` erzeugt den Webbuild und den Node-Server. `npm start` liefert den Webclient, `/api` und `/ws` unter einem Origin aus; dafür sind mindestens `WEB_ORIGIN=https://deine-domain` und ein persistentes `VEDRAS_DATA_DIR` zu setzen. Der mehrstufige [Dockerfile](Dockerfile) verwendet `/data` als Volume und läuft als nicht privilegierter Node-Benutzer. Die vollständige Anleitung für TLS-Proxy, Healthcheck, Update, Rollback und Backup steht in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## AP4: Rastergeometrie und Gebietsteilung

Der Game Core verwendet ein orthogonales Raster als einzige Geometriequelle. `getTerritoryArea`, `isTerritoryConnected`, `getAdjacentTerritoryIds` und `getSharedBorder` arbeiten direkt auf `GridMapState`. POIs und Siedlungen/Städte liegen auf konkreten Zellen. Bei einer Zweiwege-Auktion zieht der Divider die Grenze; der First Chooser wählt in einem zweiten, core-validierten Schritt. Der neue Teil erhält eine unbenutzte Gebietskarte; bei vollständig verwendeten 48 Karten wird der gedruckte Wert der ursprünglichen Karte dupliziert. Zusätzliche Aktivierungszahl und Symbol bleiben beim ursprünglichen Kartenteil. Die Normalauktion verwendet dieselbe Rollenregel wie die Startauktion.

## AP5: Krieg und Grenzänderung

Ein Krieg sperrt beide beteiligten Gebiete für weitere Kriege in derselben Runde. Beide Spieler bestätigen verdeckt höchstens eine verfügbare ♠-Aktivierung. Danach würfelt jeder einmal mit der eingespeisten `RandomSource`. Ein ♠ aus einem Gebiet an der gegnerischen Kampfgrenze gibt +2, sonst +1; jede Festung auf einer Zelle im Verteidigungsgebiet gibt +1. Der Angreifer erhält keinen automatischen Bonus. Der `WarSnapshot` hält die Flächen und gemeinsame Grenze vor dem Kampf fest.

Bei Gleichstand endet die Grundaktion ohne Gebietsänderung. Differenz 1–2 eröffnet einen Grenzgewinn mit Basis-Tiefe 2, Differenz ab 3 bei einem Siegergebiet kleiner als die halbe Verliererfläche einen starken Vorstoß mit Basis-Tiefe 4. Eine ♦-Markierung verändert diese Basiswerte um +1 für ihren Besitzer oder −1 für dessen Gegner und verfällt nach dem Krieg. Alle Rastertiefen skalieren mit `round(Basis × sqrt(Kartenfläche / 2500))`; die Oberfläche zeigt den wirksamen Wert. Der Spieler zeichnet die direkte Übernahme im erlaubten Korridor; der Core prüft Zusammenhang, Mindestfläche und Gebietszellen. Der Spieler darf auch keine Zelle übernehmen.

Bei Differenz ab 3 und Siegerfläche mindestens der Hälfte der Verliererfläche erfolgt ab der doppelten dynamischen Mindestfläche ein Durchbruch: Der Gewinner zeichnet eine Teilung, und der Verlierer wählt zuerst. Sein Teil behält die Originalkarte und ID; der andere erhält eine neue Karte und ID. Eine ursprüngliche ♦-Markierung erlaubt anschließend eine optionale 1-Zellen-Korrektur zugunsten ihres Besitzers. Unterhalb der Schwelle wird das unterlegene Gebiet vollständig erobert, ohne mit einem anderen Gebiet zu verschmelzen. Ein geschwächtes Gebiet wird bei jeder Niederlage mit mindestens einem Punkt vollständig erobert; ein geschwächter Sieger verliert seine Schwächung.

POIs und Siedlungen/Städte bleiben bei jeder Rasteränderung auf ihren Zellen. Trennt ein direkter Grenzgewinn kleinere Restkomponenten vom Verlierer ab, fallen sie automatisch an den Gewinner. Die eindeutige größte Restkomponente behält TerritoryId und Karte; gleich große größte Komponenten machen die Auswahl ungültig. Für eine Schwächung berechnet der Core ausschließlich vom gespeicherten ursprünglichen Grenzverlauf eine orthogonale BFS-Tiefe im ursprünglichen Verlierergebiet. Ließe der vollständig simulierte, topologisch aufgelöste Streifen weniger als die dynamische Mindestfläche zurück, wird das Gebiet geschwächt; eine topologisch mehrdeutige oder rein geometrisch begrenzte Vorschau bewirkt keine Schwächung.

## Installation und Entwicklung

Voraussetzung ist Node.js 20 oder neuer mit npm. Im Repository-Stammverzeichnis:

```sh
npm install
npm run dev
```

Danach ist der lokale Client gewöhnlich unter [http://localhost:5173](http://localhost:5173) erreichbar. `npm run dev:core` startet separat den TypeScript-Watch-Modus des Game Core. `npm run dev:server` und `npm run dev:web` starten die beiden Mehrspieler-Prozesse einzeln.

## Prüfung

```sh
npm run build
npm run typecheck
npm test
npm run test:e2e
```

Die Node-Tests prüfen Core-Regeln sowie Room-Lifecycle, Sessions, autoritative Commands, Deduplizierung und redigierte WebSocket-Snapshots. `npm run test:e2e` startet für Playwright einen isolierten Server und Browser-Client; es prüft Kartenbau, Karteninteraktion sowie das Erstellen, Beitreten und Starten eines Mehrspielerraums.

## Weitere Arbeitspakete

Der Core validiert Aktionen und gibt einen neuen Zustand mit Domain-Ereignissen zurück; ungültige Aktionen ändern den Eingangszustand nicht. Die dateibasierte Room-Persistenz ist für einen einzelnen kleinen Server gedacht; bei späterem Hosting mit mehreren Instanzen ist ein gemeinsamer persistenter Store sinnvoll.
