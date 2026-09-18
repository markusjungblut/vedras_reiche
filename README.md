# Vedras Reiche

Dieses Repository enthält den headless Game Core für eine digitale Version von **Vedras Reiche**. Arbeitspaket 1 legte Modelle und Regelwerte an, Arbeitspaket 2 die Rundensteuerung und Aktivierungsphase. Arbeitspaket 3 ergänzt Startauktionen, normale Auktionen und den Ablauf der Aktionsphase. Browser-Client und Multiplayer-Server sind weiterhin Platzhalter.

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

## Startauktionen

Vor Runde 1 finden zwei Startauktionsrunden statt. Jede legt mit der eingespeisten `RandomSource` `Spielerzahl + 1` neutrale Gebiete in zufälliger, anschließend fester Reihenfolge aus. Die zweite Auslage enthält keine Gebiete der ersten, auch wenn diese neutral geblieben sind. Das nächste noch neutrale Gebiet der Auslage wird versteigert; nach dem letzten Gebiet beginnt ein weiterer Durchlauf durch dieselbe Auslage. Der Auktionssteller wandert nach jeder einzelnen Auktion im Uhrzeigersinn. Er wählt das Gebiet nicht aus.

In jeder Startauktionsrunde erhält jeder Spieler die Gebote `0` bis `Spielerzahl`. Nur Spieler ohne Gebiet aus dieser Runde bieten mit. Jedes aufgedeckte Gebot wird verbraucht, auch die `0` und auch bei einem verlorenen Gebot. Ein Spieler ohne Gebiet erhält sofort einen neuen vollständigen Satz, wenn sein Satz aufgebraucht ist. Ein eindeutiger Höchstbietender erhält das Gebiet und scheidet für diese Startauktionsrunde aus. Bei lauter Nullen oder mindestens drei Höchstbietenden bleibt das Gebiet neutral. Genau zwei Höchstbietende führen zu einer ausstehenden Gebietsteilung, bis eine Geometrieauflösung eine legale Teilung oder deren Unmöglichkeit meldet. Nach zwei vollständig abgeschlossenen Runden besitzt jeder Spieler zwei Gebiete; für das reguläre Spiel stehen sechs globale Einflusspunkte und die Grundgebote `1`, `2`, `3` bereit.

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

## Aktionsphase und normale Auktionen

Die Aktionsphase beginnt beim Startspieler und läuft im Uhrzeigersinn. Jeder Spieler führt genau eine Grundaktion aus. Der aktuelle Spieler kann eine Auktion für ein unmittelbar angrenzendes neutrales Gebiet eröffnen; ein Krieg ist als spätere Alternative vorgesehen. Nur wenn weder Auktion noch ein möglicher Krieg existiert, verfällt die Grundaktion. Ein Gebiet, das ein Spieler in der Auktion eines anderen gewinnt, verbraucht seine eigene Grundaktion nicht.

Bei einer normalen Auktion müssen alle Spieler verdeckt bieten, auch ohne Nachbarschaft zum Gebiet. Ein Gebot besteht aus einem verfügbaren Grundgebot `1`, `2` oder `3`, ganzzahligem globalem Einfluss und gegebenenfalls eigenem lokalem Einfluss auf dem versteigerten Gebiet. Der Core wertet erst aus, wenn alle Gebote vorliegen. Nur wer tatsächlich ein Gebiet erhält, bezahlt Einfluss und erschöpft das eingesetzte Grundgebot. Nach Erschöpfung aller drei Grundgebote steht sofort ein neuer vollständiger Satz zur Verfügung. Wird das Gebiet vergeben, verfällt sämtlicher dort verbliebener lokaler Einfluss.

Bei genau zwei Höchstbietenden bleibt die Auktion bis zur Entscheidung über eine legale Gebietsteilung offen. Bei mindestens drei Höchstbietenden bleibt das Gebiet neutral und niemand bezahlt. Nach dem ersten solchen Gleichstand darf der aktive Spieler innerhalb derselben Grundaktion eine zweite Auktion eröffnen oder seinen Zug beenden. Eine dritte Auktion ist nicht möglich. Nach vollständig abgewickelter Aktion folgt der nächste Spieler. Erst nach der letzten Aktion ist die Runde abgeschlossen und kann die nächste beginnen; nach der letzten Spielrunde folgt `SCORING`.

Gebote liegen bis zur gemeinsamen Aufdeckung verdeckt im Game-Core-Zustand. Ein späterer Server muss vor der Aufdeckung die Gebotshöhen aus den Ansichten anderer Spieler entfernen.

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

Die Tests verwenden den integrierten Test-Runner von Node.js. Sie prüfen Grundmodelle, kontrollierte Zufallsfolgen, Aktivierungen, Auktionsausgänge, ungültige Aktionen und Phasenübergänge.

## Grenze dieses Arbeitspakets

Der Core validiert Aktionen und gibt einen neuen Zustand mit Domain-Ereignissen zurück; ungültige Aktionen ändern den Eingangszustand nicht. Die tatsächliche Gebietsteilung und Grenzgeometrie, Kriegsauswertung, Wertung, grafische Karte und Multiplayer bleiben spätere Arbeitspakete. Eine ausstehende Gebietsteilung wird bis zu einer kontrolliert gelieferten Auflösung nicht als Flächenrechnung simuliert.
