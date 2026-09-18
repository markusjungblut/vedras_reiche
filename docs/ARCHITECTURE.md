# Architektur

Regelquelle ist die [ausführliche Spielanleitung](rules/Vedras%20Reiche.docx) im Repository.

## Ebenen und Verantwortlichkeiten

```text
┌──────────────────────────────┐
│ Visual Debug Client          │
│ React + Vite, lokal im Browser│
└──────────────┬───────────────┘
               │ Game Actions
               ▼
┌──────────────────────────────┐
│ @vedras/game-core            │
└──────────────────────────────┘
```

Der Visual Debug Client erfasst Entscheidungen, ruft Core-Aktionen direkt auf und zeigt deren neuen Zustand sowie Ereignisse. Diese direkte Verbindung ist **nur ein lokaler Entwicklungsmodus** mit Pass-and-play. Der Browser darf in einer späteren Multiplayer-Version seinen maßgeblichen Spielzustand nicht selbst bestimmen. Dann gilt `Browser → Server → Game Core`: Der Server verwaltet den maßgeblichen Zustand, prüft die Berechtigung eingehender Aktionen und verteilt bestätigte Ergebnisse. Transport, Sitzungen und Persistenz liegen außerhalb des Game Core.

Der Debug Client besitzt einen reproduzierbaren Seed, Testkarte, Kartenziehquelle und vorbereitete Szenarien. Diese Hilfen liegen ausschließlich unter `apps/web`; spielrelevante Änderungen laufen ausschließlich über Core-Aktionen; die React-Komponenten speichern nur Anzeige- und Eingabezustand.

`packages/game-core` enthält die Spielmodelle und Regeln als eigenständige TypeScript-Bibliothek. Der Core hängt nicht von React, DOM, Canvas, WebSockets, Datenbanken oder Browser-APIs ab. Server, Tests, Bots und spätere Replay-Werkzeuge können dieselben Zustandsübergänge verwenden.

## Rasterkarte als Domain-Wahrheit

`GameState.map` ist nach dem Kartenaufbau die autoritative Geometrie. Jede belegte Rasterzelle verweist auf eine `TerritoryId` oder ist `null`. Fläche, orthogonaler Zusammenhang, Nachbarschaften und gemeinsame Grenzen werden aus diesen Zellen berechnet. Diagonaler Eckkontakt ist keine Nachbarschaft. Die SVG-Karte im Browser ist eine Darstellung dieser Daten und keine eigene Regelquelle.

POIs und positionierte Siedlungen/Städte speichern eine konkrete `GridCell`. POI-Zugehörigkeit wird stets aus der Zelle selektiert. `reconcileMapBoundFeatures` ordnet Siedlungen und Städte nach jeder AP5-Kartenänderung ihrer neuen TerritoryId zu, auch wenn mehrere Features in einem Gebiet landen. Die Kartenabmessungen bleiben über `GridMapConfig` konfigurierbar; A4 und A5 liefern Mindestflächen von 20 beziehungsweise 10 Kästchen.

## Geometrischer Cut-and-Choose-Ablauf

Eine Zweiwege-Auktionsteilung durchläuft `AWAITING_DIVISION` und `AWAITING_CHOICE`. Der Divider liefert ausschließlich `partACells` und die Entscheidung, welcher Teil die ursprüngliche Karte behält. Teil B ist das exakte Komplement des ursprünglichen Gebiets. Der Core prüft Besitz der Zellen, Nichtleere, Mindestflächen und orthogonalen Zusammenhang. Erst danach wählt der festgelegte First Chooser einen Teil; Besitzer, neue Karte, Karte und lokale Einflüsse werden atomar aktualisiert. Nachbarschaften werden anschließend erneut aus der Karte selektiert. Die öffentliche Aktion `ResolveTerritorySplit` akzeptiert nur die anhand einer zu kleinen Rasterfläche nachweisbare Unmöglichkeit; fertige `Territory`-Objekte sind kein legaler Auflösungsweg mehr. Für verwinkelte Flächen mit rechnerisch genügend Zellen sucht der Core nicht erschöpfend nach einer möglichen Aufteilung. Solche Fälle bleiben offen, statt eine mögliche legale Teilung fälschlich auszuschließen.

Für echte Replays muss jede Kartenmutation rekonstruierbar sein oder periodisch mit einem Map-Snapshot gespeichert werden. Ein Persistenzsystem ist noch nicht Teil dieser Arbeitspakete.

## Spieleransichten und verdeckte Entscheidungen

Ein späterer Multiplayer-Server darf keine vollständige `GameState` an Clients senden. `createGameViewForPlayer` liefert eine serverseitig redigierte `PlayerGameView`: Das eigene Gebot bleibt sichtbar, gegnerische laufende Gebote werden durch ein reines `submitted`-Merkmal ersetzt. Während der Kriegswahl zeigt sie vom Gegner nur `LOCKED` statt der gewählten ♠-ID. Aufdeckung erfolgt durch den regulären Domain-Ablauf; CSS-Ausblenden ist keine Sicherheitsgrenze.

## Aktionen, Fehler und Ereignisse

```text
GameState + GameAction + kontrollierte externe Quellen
                     ↓
                 Validierung
                     ↓
           neuer GameState + GameEvents
```

Aktionen tragen die Entscheidungen der Spieler, etwa Aktivierungsziel, Auktionsgebiet oder verdecktes Gebot. Der Core prüft Phase, aktiven Spieler, Berechtigung und Ressourcen, bevor er einen Effekt anwendet. Ungültige Aktionen liefern einen testbaren Domain-Fehler und verändern den Eingabezustand nicht. Ereignisse mit passenden Payloads dokumentieren bestätigte Zustandsübergänge. UI-Texte gehören nicht in diese Fehler oder Ereignisse.

## Rundenablauf

Der Zustand hält aktuelle Runde, Höchstzahl, Phase und Startspieler. Die Reihenfolge der Spieler ist dauerhaft festgelegt. Die erste Startspielerwahl bezieht Zufall ausschließlich über die eingespeiste `RandomSource`. Nach jeder vollständig abgeschlossenen Runde folgt der nächste Spieler in dieser Reihenfolge; am Listenende beginnt sie wieder vorne. Eine neue Runde setzt nur eindeutig rundenbezogene Zustände zurück und beginnt mit der Aktivierungsphase.

```text
zwei Startauktionsrunden abschließen
  → Runde beginnen
  → drei verschiedene Aktivierungszahlen würfeln
  → passende kontrollierte Gebiete ermitteln
  → Aktivierungsphase abwickeln
  → Aktionsphase vollständig abwickeln
  → Runde beenden
  → nächste Runde oder SCORING
```

`startRound` prüft den Abschluss der vorherigen Runde. Während einer laufenden Aktionsphase, Auktion oder ausstehenden Teilung kann keine neue Runde gestartet werden. Nach der letzten Aktionsphase geht der Zustand in `SCORING`; die Punktewertung selbst folgt später.

## Startauktionen

`START_AUCTIONS` umfasst genau zwei Runden vor dem regulären Spiel. Pro Runde wählt die eingespeiste `RandomSource` `Spielerzahl + 1` neutrale Gebiete und ihre offene Auslagereihenfolge. Die zweite Runde schließt alle Gebiete der ersten Auslage aus, selbst wenn sie neutral geblieben sind. Der Core versteigert jeweils das nächste neutrale Gebiet dieser festen Reihenfolge. Am Ende der Auslage beginnt er bei Bedarf wieder beim ersten noch neutralen Gebiet; er zieht keine neue Auslage. Niemand wählt ein Zielgebiet frei aus.

Der erste Auktionssteller ist der nächste Spieler im Uhrzeigersinn nach dem Kartenzeichnen beziehungsweise der unmittelbar vorhergehenden Setup-Aktion. Die Rolle wandert nach jeder einzelnen Startauktion weiter und ist von der Menge der Bieter getrennt. Jeder Spieler ohne Gebiet in der aktuellen Startauktionsrunde muss mitbieten. Pro Runde besitzt er den Satz `0` bis `Spielerzahl`; jedes aufgedeckte Gebot verfällt unabhängig vom Ausgang. Wer noch kein Gebiet hat und den ganzen Satz verbraucht, erhält sofort einen neuen Satz. Ein Gewinner bietet erst in der nächsten Startauktionsrunde wieder. Diese beginnt für alle mit einem frischen Satz.

Ein eindeutiger Höchstbietender erhält das Gebiet. Bei lauter Nullen oder mindestens drei Höchstbietenden bleibt es neutral. Bei genau zwei Höchstbietenden wird die Auktion für eine geometrische Teilungsentscheidung ausgesetzt. Der Core prüft die Rasterpartition und lässt Divider und First Chooser anschließend getrennt handeln. Bei einer unmöglichen Teilung bleibt das Gebiet neutral. Sobald alle Spieler in jeder der beiden Runden ein Gebiet erhalten haben, muss jeder genau zwei Gebiete besitzen. Der reguläre Startzustand hält dann sechs globale Einflusspunkte und verfügbare Grundgebote `1`, `2`, `3` je Spieler, ohne bestehende Initialwerte nochmals zu addieren.

## Auktionszustand und verdeckte Gebote

Startauktionen und normale Auktionen verwenden denselben Ablauf. Der Core speichert Gebiet, Kontext, Eröffner beziehungsweise Auktionssteller, teilnahmeberechtigte Spieler, Gebote und Status. Ein Spieler kann pro laufender Auktion nur ein gültiges Gebot einreichen. Die Auswertung beginnt erst, wenn alle teilnahmeberechtigten Spieler geboten haben.

```text
OPEN → BIDDING → REVEAL → RESOLUTION
                         ↘ PENDING_SPLIT → RESOLUTION
```

`REVEAL` und `RESOLUTION` können in einem synchronen Zustandsübergang erfolgen; sie benennen die fachliche Reihenfolge. `PENDING_SPLIT` blockiert den weiteren Auktions- und Phasenablauf, bis Divider und First Chooser die geometrisch geprüfte Teilung abgeschlossen haben. Ein legaler Split unterscheidet den Teil mit der ursprünglichen Gebietskarte vom neu entstandenen Teil. Dieser erhält eine bisher ungenutzte Karte; wenn alle 48 gedruckten Karten im Spiel sind, wird die ursprüngliche Gebietskarte dupliziert. Der Core leitet Teil B aus dem Komplement der angegebenen Zellen ab, aktualisiert die Karte und berechnet Nachbarschaften erneut. Bei normalen Auktionen werden Zahlungen und lokaler Einfluss erst nach einer erfolgreichen Teilung verarbeitet. Die gemeinsame Rollenfunktion gilt für Start- und normale Auktionen.

Die Gebotshöhen sind bis zur gemeinsamen Aufdeckung verborgenes Domain-Wissen. Die Spieleransicht redigiert noch nicht aufgedeckte Gebote; ein zukünftiger Server muss diese Projektion statt des vollständigen Zustands senden. Der Core darf die Werte intern für die Auflösung speichern. Kryptografie und Commit-Reveal gehören nicht zu diesem Arbeitspaket.

## Aktionsphase und normale Auktionen

Die Aktionsphase verwendet dieselbe Spielerreihenfolge wie die Aktivierungsphase, beginnend beim Startspieler. Der Zustand zeigt den aktuellen Spieler, abgeschlossene Grundaktionen und gegebenenfalls eine aktive Auktion oder ausstehende Teilung. Nur der aktuelle Spieler darf seine normale Auktion eröffnen. Das Gebiet muss neutral sein und unmittelbar an mindestens eines seiner Gebiete angrenzen. Alle Spieler müssen bieten, auch ohne eigene Nachbarschaft zum Zielgebiet.

Ein normales Gebot besteht aus einem verfügbaren Grundgebot `1`, `2` oder `3` sowie einer nicht negativen ganzen Zahl globaler Einflusspunkte und gegebenenfalls lokalem Einfluss des Bieters auf genau diesem Gebiet. Beim Einreichen werden keine Ressourcen abgezogen. Nur Spieler, die bei der Auflösung tatsächlich Gebiet erhalten, bezahlen Einfluss und erschöpfen ihr Grundgebot. Sind `1`, `2` und `3` dadurch erschöpft, regeneriert sofort der ganze Satz. Ein Gewinn in einer fremden Auktion verbraucht die eigene Grundaktion nicht. Nach einem Besitzerwechsel verfällt aller noch auf dem Gebiet gespeicherte lokale Einfluss.

Ein eindeutiger Höchstbietender erhält das Gebiet. Bei genau zwei Höchstbietenden wartet die Auktion auf eine legale Teilung; bei deren Erfolg erhalten beide einen Teil und bezahlen ihr jeweiliges Gebot. Ist sie unmöglich, bleibt das Gebiet neutral; ohne Gebietsgewinn werden keine Grundgebote erschöpft und kein Einfluss bezahlt. Bei mindestens drei Höchstbietenden bleibt es ebenfalls neutral und niemand bezahlt. Nach dem **ersten** solchen Dreiergleichstand kann der aktive Spieler innerhalb derselben Grundaktion optional eine zweite Auktion für dasselbe oder ein anderes angrenzendes neutrales Gebiet eröffnen oder den Zug beenden. Danach endet die Grundaktion unabhängig vom Ergebnis; es gibt keine dritte Auktion.

```text
aktueller Spieler
  → legale Auktion eröffnen und alle Gebote sammeln
  → Auktion einschließlich möglicher Teilung auflösen
  → gegebenenfalls optionale zweite Auktion oder Zugende
  → nächster Spieler
  → nach der letzten Grundaktion: Runde beenden
```

Krieg ist die alternative Grundaktion für ein eigenes Gebiet und einen angrenzenden gegnerischen Nachbarn. `currentActionKind` trennt den begonnenen Auktions- und Kriegsweg. Ein `PendingWar` blockiert alle anderen Grundaktionen und den Rundenwechsel. Ein Spieler ohne angrenzendes neutrales Gebiet darf nicht allein deswegen übersprungen werden; auch ein möglicher Krieg zählt als legale Option. Erst wenn beides fehlt, verfällt die Grundaktion.

## Aktivierungsphase

Für jede der drei Zahlen wählt der erste W6 eines von sechs benachbarten Zahlenpaaren zwischen 1 und 12. Der zweite W6 wählt bei 1 bis 3 die niedrigere und bei 4 bis 6 die höhere Zahl. Ein erneut getroffenes Ergebnis wird verworfen und neu gewürfelt; die Reihenfolge der drei unterschiedlichen Ergebnisse bleibt erhalten. Kontrollierte Gebiete mit einer passenden ersten oder zweiten Aktivierungszahl werden einmal vorgemerkt, neutrale Gebiete nicht.

Die Liste wird zu Phasenbeginn festgelegt. Eine während der Phase durch ♣ neu erhaltene zweite Zahl führt erst ab der nächsten Runde zu einer zusätzlichen Aktivierung.

Die Bearbeitungsreihenfolge beginnt beim Startspieler und läuft im Uhrzeigersinn. Der Aktivierungszustand zeigt den aktuellen Spieler und dessen offene Gebiete. Bei mehreren offenen Gebieten trifft der Spieler die Auswahl; die Engine legt ihre Reihenfolge nicht fest. Erst nach gültiger Symbol- und Zielwahl sowie ausgeführter oder ausdrücklich vorgemerkter Wirkung gilt ein Gebiet als abgehandelt. Danach bleibt derselbe Spieler für seine übrigen Gebiete aktiv. Spieler ohne offene Aktivierungen werden übersprungen. Sind keine mehr offen, erzeugt der Core den Phasenwechsel zur Aktionsphase.

Die Symbolwahl berücksichtigt ein mögliches zweites Symbol. Eine Aktivierung löst genau eine der vorhandenen Fähigkeiten aus. ♣ kann zusätzlich eine zweite Aktivierungszahl oder ein zweites Symbol erzeugen; diese Spezialisierungen schließen sich gegenseitig aus, während eine Siedlung oder Stadt daneben bestehen kann. ♥ verändert globalen oder lokalen Einfluss. ♦ markiert eine gegnerische Grenze oder pausiert die Aktivierung für eine geometrische Verschiebung zu einem neutralen Gebiet. ♠ speichert Spieler, Herkunftsgebiet und Verfügbarkeit eines später einmal verwendbaren Kampfbonus.

Für die zweite ♣-Aktivierungszahl bezieht der Core die zufällig gezogene Gebietskarte aus einer eingespeisten `CardSource`. Deren Vertrag umfasst das Zurücklegen und erneute Mischen der Karte. Dieselbe Zahl wie auf der ursprünglichen Gebietskarte führt zu einem weiteren Zug.

## Rundenbezogene Effekte

Gespeicherte ♠-Aktivierungen bleiben für die laufende Runde verfügbar und können später im Krieg genau einmal verbraucht werden. Nicht genutzte Aktivierungen verfallen am Rundenende. Die Kriegsteilnahme-Sperre je Gebiet wird bei Rundenbeginn zurückgesetzt; Schwächung bleibt bestehen. Auch der Aktivierungsfortschritt und die drei Würfelzahlen gehören zur laufenden Runde. Grenzmarkierungen bleiben bis zum nächsten Krieg an ihrer Grenze bestehen und werden bei dessen Beginn entfernt.

## Determinismus und Replay

Alle Zufallswerte stammen aus einer austauschbaren `RandomSource`; im Regelcode steht kein direktes `Math.random()`. Tests können W6-Werte und die zufällige Startauslage kontrolliert vorgeben. Ein späterer Server kontrolliert die Quelle. Für ein Replay müssen Ausgangszustand, Reihenfolge der Aktionen und verwendete Zufallswerte reproduzierbar sein. Das Speicherformat ist noch offen.

## Nachbarschaft und Grenzmarkierung

♣-Entwicklungsziele, ♥-Einflussziele, ♦-Nachbarn, Auktions- und Kriegsziele verwenden die aus gemeinsamen Rasterkanten berechnete Nachbarschaft. Eine gegnerische markierte Grenze wird über ein stabiles, reihenfolgeunabhängiges Paar von Gebiets-IDs identifiziert; `A–B` und `B–A` bezeichnen dieselbe Grenze. Neutrale ♦-Grenzverschiebungen verwenden denselben Korridorvalidator wie Kriegsgrenzgewinne mit Tiefe 2. Die Aktivierung bleibt bis zur bestätigten Geometrieänderung offen; eine leere Auswahl ist zulässig.

## Kriegsablauf

`StartWar` prüft Spieler, Besitzer, Raster-Nachbarschaft, freie Grundaktion und beide Kriegsteilnahme-Sperren. Der `WarSnapshot` hält die beiden ursprünglichen Flächen, die gemeinsame Rastergrenze und eine mögliche ♦-Markierung fest. Beide Gebiete werden sofort für den Rest der Runde gesperrt. Der Ablauf ist:

```text
AWAITING_COMBAT_CHOICES
  → beide ♠-Entscheidungen bestätigt
  → 1W6 pro Seite + ♠ + Festungen des Verteidigers
  → Gleichstand: Krieg und Grundaktion beenden
  → Grenzgewinn/starker Vorstoß: AWAITING_BORDER_ADVANCE
  → Durchbruch bei großer Verliererfläche: AWAITING_CUT_DIVISION
      → AWAITING_CUT_CHOICE
      → optional AWAITING_DIAMOND_CORRECTION
  → sonst vollständige Eroberung
  → Krieg und Grundaktion beenden
```

Die Zufallsquelle wird nur nach beiden bestätigten Entscheidungen angesprochen. Der Angreifer erhält keinen automatischen Bonus. Eine ♠-Aktivierung an der gegnerischen Kampfgrenze gibt +2, eine entfernte +1; höchstens eine je Spieler und Krieg. Festungen werden anhand ihrer aktuellen Kartenposition im Verteidigungsgebiet gezählt und geben je +1. `CombatResult` speichert Einzelwürfe, Boni, Gesamtsummen, absolute Differenz und Ergebnis.

Bei Differenz 1–2 ist die maximale Tiefe 2. Bei Differenz ab 3 entscheidet das Verhältnis der vor dem Kampf gespeicherten Flächen: Ist die Siegerfläche kleiner als die halbe Verliererfläche, beträgt die Vorstoßtiefe 4. Andernfalls wird ab doppelter Mindestfläche des Verlierers geteilt, darunter vollständig erobert. Eine Niederlage eines bereits geschwächten Gebiets führt unabhängig davon zur Eroberung. Ein geschwächter Sieger verliert die Schwächung, bei Gleichstand bleibt sie. Eroberung wechselt nur `ownerId`; Gebiet, Karte und Geometrie bleiben eigenständig.

`getCellsWithinBorderDepth` führt eine Breitensuche ausschließlich innerhalb des ursprünglichen Verlierergebiets von der ursprünglichen gemeinsamen Grenze aus. `validateBorderAdvance` prüft die übermittelten Zellen, den Korridor, Mindestfläche und Zusammenhang beider Gebiete; eine leere Auswahl ist gültig. ♦ verändert Grenzgewinn und starken Vorstoß um +1 oder −1 Tiefe. Beim Kriegs-Cut teilt der Sieger das unterlegene Gebiet mit der vorhandenen AP4-Splitprüfung, der Verlierer behält seinen gewählten Teil samt Originalkarte und ID. Nur hier entsteht ein neuer Gebietsteil mit neuer Karte. Eine ♦-Markierung erlaubt danach eine weitere validierte 1-Zellen-Korrektur zugunsten ihres Besitzers.

Die Anleitungsformulierung zur durch Mindestfläche eingeschränkten „vollständigen Front“ bestimmt keine eindeutige Rasterlinie. `assessBorderAdvanceLimitation` isoliert diesen einzigen offenen Punkt und gibt bis zu einer präzisen Regelentscheidung `determinate: false` zurück. Grenzgewinne setzen deshalb derzeit keine neue Schwächung; bestehende Schwächung wirkt im Kampf vollständig. Siehe [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md).

## Stand und weitere Arbeitspakete

Arbeitspaket 5 ergänzt Kriegsauswertung und geometrische Grenzverschiebungen. Punktewertung, Savegame und Multiplayer-Server sind noch ausstehend. Die verbleibende Schwächungs-Formalisierung steht in [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md).
