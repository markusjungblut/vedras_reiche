# Vedras Reiche

Dieses Repository enthält den headless Game Core für eine digitale Version von **Vedras Reiche**. Arbeitspaket 1 legte Modelle und Regelwerte an; Arbeitspaket 2 ergänzt die Rundensteuerung und eine vollständig abwickelbare Aktivierungsphase. Browser-Client und Multiplayer-Server sind weiterhin Platzhalter.

Die [ausführliche Spielanleitung](docs/rules/Vedras%20Reiche.docx) ist die maßgebliche Regelquelle. Nicht eindeutig belegte Regeln werden nicht ergänzt; tatsächlich offene Punkte stehen in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

## Architektur

```text
Web Client → Multiplayer Server → Game Core
```

Der Game Core verarbeitet Spielzustand und Aktionen unabhängig von Oberfläche und Transport. Der spätere Server hält den maßgeblichen Zustand und verteilt bestätigte Ergebnisse. Die Zuständigkeiten und Zustandsübergänge stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Projektstruktur

```text
apps/
  web/               Platzhalter für den Browser-Client
  server/            Platzhalter für den Multiplayer-Server
packages/
  game-core/
    src/             Modelle, Aktionen, Ereignisse, Regeln und Zustand
    tests/           automatisierte Core-Tests
docs/
  ARCHITECTURE.md
OPEN_QUESTIONS.md
```

Das Repository verwendet npm Workspaces und TypeScript im Strict Mode.

## Runden und Aktivierungen

Eine Runde beginnt mit der Aktivierungsphase und geht danach in die Aktionsphase über. Der erste Startspieler wird über die eingespeiste `RandomSource` bestimmt. Nach jeder vollständig abgeschlossenen Runde wandert diese Rolle in der festgelegten Spielerreihenfolge im Uhrzeigersinn weiter. Der Zustand hält die aktuelle Runde und die für die Spielerzahl geltende Höchstzahl fest.

Zu Beginn der Aktivierungsphase entstehen genau drei verschiedene Zahlen zwischen 1 und 12. Jede Zahl wird mit zwei W6 bestimmt: Der erste Würfel wählt eines der Paare `1/2` bis `11/12`; der zweite wählt bei `1–3` die niedrigere und bei `4–6` die höhere Zahl. Doppelte Ergebnisse werden neu gewürfelt. Der Core verwendet dafür kein direktes `Math.random()`, sodass Tests die Würfelfolge genau vorgeben können.

Alle kontrollierten Gebiete mit mindestens einer passenden Aktivierungszahl werden je einmal aktiviert; neutrale Gebiete bleiben aus. Die Spieler sind vom Startspieler aus im Uhrzeigersinn an der Reihe. Hat ein Spieler mehrere offene Gebiete, wählt er deren Reihenfolge selbst durch einzelne Aktivierungsaktionen. Jede Aktion enthält die nötige Symbol- und Zielwahl. Nach einem gültigen Effekt wird das Gebiet als abgehandelt markiert. Spieler ohne offene Gebiete werden übersprungen. Sobald alle Aktivierungen erledigt sind, wechselt der Zustand in die Aktionsphase.

Die offenen Aktivierungen werden zu Beginn der Phase ermittelt. Erhält ein Gebiet währenddessen durch ♣ eine zweite Zahl, kann diese erst ab der nächsten Runde eine Aktivierung auslösen.

| Symbol | Wirkung in Arbeitspaket 2 |
| --- | --- |
| ♦ Karo | Eine Grenze zu einem angrenzenden gegnerischen Gebiet kann einmal markiert werden. Eine Grenzverschiebung zu einem neutralen Nachbarn wird nur als ausstehender geometrischer Effekt erfasst. |
| ♣ Kreuz | Eigenes Gebiet oder eigener Nachbar erhält bei einer Aktivierung eine Siedlung, wird zur Stadt entwickelt oder erhält eine Spezialisierung. Zweite Aktivierungszahl und zweites Symbol schließen sich gegenseitig aus; Siedlung oder Stadt kann daneben bestehen. |
| ♥ Herz | Wahl zwischen genau einem globalen Einfluss oder zwei lokalen Einflusspunkten auf einem angrenzenden neutralen Gebiet. |
| ♠ Pik | Ein einmal verwendbarer Bonus mit Spieler und Herkunftsgebiet wird für die laufende Runde vorgemerkt und verfällt am Rundenende, wenn er ungenutzt bleibt. Die Bonusberechnung gehört zum späteren Kriegssystem. |

Nachbarschaften liegen derzeit als logische Beziehungen zwischen Gebieten vor. Sie reichen für Zielvalidierung und Grenzmarkierungen. Die tatsächliche Karten- und Grenzgeometrie, einschließlich einer Verschiebung um bis zu zwei Kästchen, ist noch nicht modelliert. Die abstrakte Gebietsfläche ersetzt keine Raster- oder Polygonberechnung.

## Installation und Entwicklung

Voraussetzung ist Node.js 20 oder neuer mit npm. Im Repository-Stammverzeichnis:

```sh
npm install
npm run dev
```

`dev` startet den TypeScript-Watch-Modus für den Game Core; es startet keinen Browser-Client und keinen Multiplayer-Server.

## Prüfung

```sh
npm run build
npm run typecheck
npm test
```

Die Tests verwenden den integrierten Test-Runner von Node.js. Neben den Grundmodellen prüfen sie kontrollierte Zufallsfolgen, Aktivierungsreihenfolge, Symbolfähigkeiten, ungültige Aktionen und einen durchgehenden Übergang von der Aktivierungsphase in die Aktionsphase.

## Grenze dieses Arbeitspakets

Der Core validiert Aktivierungsaktionen und gibt einen neuen Zustand mit Domain-Ereignissen zurück; ungültige Aktionen ändern den Eingangszustand nicht. Die Aktionsphase ist als nächster Zustand vorhanden. Auktionen, Kriege, grafische Karte und Multiplayer werden in späteren Arbeitspaketen ausgeführt.
