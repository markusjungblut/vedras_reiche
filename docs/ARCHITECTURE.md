# Architektur

Regelquelle ist die [ausführliche Spielanleitung](rules/Vedras%20Reiche.docx) im Repository.

## Ebenen und Verantwortlichkeiten

```text
Web Client
    ↓ Aktion vorschlagen
Multiplayer Server
    ↓ Aktion mit aktuellem Zustand verarbeiten
Game Core
    ↑ neuer Zustand und Ereignisse
```

Der künftige Browser-Client zeigt bestätigte Spielinformationen und erfasst Entscheidungen. Der spätere Multiplayer-Server verwaltet den maßgeblichen Zustand, prüft die Berechtigung eingehender Aktionen und verteilt bestätigte Ergebnisse. Transport, Sitzungen und Persistenz liegen außerhalb des Game Core. Beide Anwendungen sind derzeit Platzhalter.

`packages/game-core` enthält die Spielmodelle und Regeln als eigenständige TypeScript-Bibliothek. Der Core hängt nicht von React, DOM, Canvas, WebSockets, Datenbanken oder Browser-APIs ab. Server, Tests, Bots und spätere Replay-Werkzeuge können dieselben Zustandsübergänge verwenden.

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

Ein eindeutiger Höchstbietender erhält das Gebiet. Bei lauter Nullen oder mindestens drei Höchstbietenden bleibt es neutral. Bei genau zwei Höchstbietenden wird die Auktion für eine Teilungsentscheidung ausgesetzt. Ist die Teilung legal, zeichnet gemäß §8 der Auktionssteller selbst, wenn er zu den Höchstbietenden gehört; sonst zeichnet der vom Auktionssteller aus nächste der beiden Höchstbietenden im Uhrzeigersinn. Der andere wählt zuerst. Die tatsächliche Grenzlinie gehört zu einem späteren Arbeitspaket. Bei einer unmöglichen Teilung bleibt das Gebiet neutral. Sobald alle Spieler in jeder der beiden Runden ein Gebiet erhalten haben, muss jeder genau zwei Gebiete besitzen. Der reguläre Startzustand hält dann sechs globale Einflusspunkte und verfügbare Grundgebote `1`, `2`, `3` je Spieler, ohne bestehende Initialwerte nochmals zu addieren.

## Auktionszustand und verdeckte Gebote

Startauktionen und normale Auktionen verwenden denselben Ablauf. Der Core speichert Gebiet, Kontext, Eröffner beziehungsweise Auktionssteller, teilnahmeberechtigte Spieler, Gebote und Status. Ein Spieler kann pro laufender Auktion nur ein gültiges Gebot einreichen. Die Auswertung beginnt erst, wenn alle teilnahmeberechtigten Spieler geboten haben.

```text
OPEN → BIDDING → REVEAL → RESOLUTION
                         ↘ PENDING_SPLIT → RESOLUTION
```

`REVEAL` und `RESOLUTION` können in einem synchronen Zustandsübergang erfolgen; sie benennen die fachliche Reihenfolge. `PENDING_SPLIT` blockiert den weiteren Auktions- und Phasenablauf, bis eine kontrollierte Auflösung `LEGAL_SPLIT` oder `SPLIT_NOT_POSSIBLE` liefert. Ein legaler Split unterscheidet den Teil mit der ursprünglichen Gebietskarte vom neu entstandenen Teil. Dieser erhält eine bisher ungenutzte Karte; wenn alle 48 gedruckten Karten im Spiel sind, wird die ursprüngliche Gebietskarte dupliziert. Die externe Kartenauflösung liefert die beiden Teile und die neue Karte. Der Core prüft deren Struktur und Kartenbelegung, aber simuliert weder Flächenanteile noch eine Grenzlinie. Bei normalen Auktionen werden Zahlungen und lokaler Einfluss erst nach einer erfolgreichen Teilung verarbeitet. Die Rollen für Grenzziehung und erste Wahl bei **normalen** Auktionen sind noch ungeklärt; sie werden nicht automatisch zugewiesen.

Die Gebotshöhen sind bis zur gemeinsamen Aufdeckung verborgenes Domain-Wissen. Ein zukünftiger Server oder View-Mapper muss noch nicht aufgedeckte Gebote in den an andere Spieler gesendeten Zuständen und Ereignissen redigieren. Der Server bleibt für die Sichtbarkeit verantwortlich; der Core darf die Werte intern für die Auflösung speichern. Kryptografie und Commit-Reveal gehören nicht zu diesem Arbeitspaket.

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

Krieg ist als alternative Grundaktion für ein eigenes Gebiet und einen angrenzenden gegnerischen Nachbarn vorgesehen. Seine Auswertung folgt in Arbeitspaket 4. Ein Spieler ohne angrenzendes neutrales Gebiet darf deshalb nicht allein deswegen übersprungen werden; auch ein möglicher Krieg zählt als legale Option. Erst wenn beides fehlt, verfällt die Grundaktion.

## Aktivierungsphase

Für jede der drei Zahlen wählt der erste W6 eines von sechs benachbarten Zahlenpaaren zwischen 1 und 12. Der zweite W6 wählt bei 1 bis 3 die niedrigere und bei 4 bis 6 die höhere Zahl. Ein erneut getroffenes Ergebnis wird verworfen und neu gewürfelt; die Reihenfolge der drei unterschiedlichen Ergebnisse bleibt erhalten. Kontrollierte Gebiete mit einer passenden ersten oder zweiten Aktivierungszahl werden einmal vorgemerkt, neutrale Gebiete nicht.

Die Liste wird zu Phasenbeginn festgelegt. Eine während der Phase durch ♣ neu erhaltene zweite Zahl führt erst ab der nächsten Runde zu einer zusätzlichen Aktivierung.

Die Bearbeitungsreihenfolge beginnt beim Startspieler und läuft im Uhrzeigersinn. Der Aktivierungszustand zeigt den aktuellen Spieler und dessen offene Gebiete. Bei mehreren offenen Gebieten trifft der Spieler die Auswahl; die Engine legt ihre Reihenfolge nicht fest. Erst nach gültiger Symbol- und Zielwahl sowie ausgeführter oder ausdrücklich vorgemerkter Wirkung gilt ein Gebiet als abgehandelt. Danach bleibt derselbe Spieler für seine übrigen Gebiete aktiv. Spieler ohne offene Aktivierungen werden übersprungen. Sind keine mehr offen, erzeugt der Core den Phasenwechsel zur Aktionsphase.

Die Symbolwahl berücksichtigt ein mögliches zweites Symbol. Eine Aktivierung löst genau eine der vorhandenen Fähigkeiten aus. ♣ kann zusätzlich eine zweite Aktivierungszahl oder ein zweites Symbol erzeugen; diese Spezialisierungen schließen sich gegenseitig aus, während eine Siedlung oder Stadt daneben bestehen kann. ♥ verändert globalen oder lokalen Einfluss. ♦ markiert eine gegnerische Grenze oder hält eine noch geometrisch auszuführende Verschiebung zu einem neutralen Gebiet fest. ♠ speichert Spieler, Herkunftsgebiet und Verfügbarkeit eines später einmal verwendbaren Kampfbonus.

Für die zweite ♣-Aktivierungszahl bezieht der Core die zufällig gezogene Gebietskarte aus einer eingespeisten `CardSource`. Deren Vertrag umfasst das Zurücklegen und erneute Mischen der Karte. Dieselbe Zahl wie auf der ursprünglichen Gebietskarte führt zu einem weiteren Zug.

## Rundenbezogene Effekte

Gespeicherte ♠-Aktivierungen bleiben für die laufende Runde verfügbar und können später im Krieg genau einmal verbraucht werden. Nicht genutzte Aktivierungen verfallen am Rundenende. Auch der Aktivierungsfortschritt und die drei Würfelzahlen gehören zur laufenden Runde. Der Core setzt beim Rundenwechsel nur diese eindeutig temporären Daten zurück; dauerhafte Gebiete, Entwicklungen, Einflusswerte und Grenzmarkierungen bleiben nach ihren jeweiligen Regeln erhalten. Insbesondere bleibt eine gegnerische ♦-Grenzmarkierung bis zum nächsten Krieg an dieser Grenze bestehen.

## Determinismus und Replay

Alle Zufallswerte stammen aus einer austauschbaren `RandomSource`; im Regelcode steht kein direktes `Math.random()`. Tests können W6-Werte und die zufällige Startauslage kontrolliert vorgeben. Ein späterer Server kontrolliert die Quelle. Für ein Replay müssen Ausgangszustand, Reihenfolge der Aktionen und verwendete Zufallswerte reproduzierbar sein. Das Speicherformat ist noch offen.

## Logische Nachbarschaft und Kartenraum

Gebiete kennen derzeit angrenzende Gebiete als IDs. Diese logische Nachbarschaft erlaubt, ♣-Entwicklungsziele, ♥-Einflussziele und ♦-Nachbarn zu prüfen. Eine gegnerische gemeinsame Grenze wird über ein stabiles, reihenfolgeunabhängiges Paar von Gebiets-IDs identifiziert; `A–B` und `B–A` bezeichnen dieselbe Grenze.

Die spätere Karte benötigt Rasterflächen oder Polygone. Nur damit lassen sich verschobene Kästchen, Zusammenhängigkeit, Mindestgröße, POIs und neu entstehende Nachbarschaften korrekt bestimmen. Die ♦-Verschiebung bis zu zwei Kästchen wird deshalb als ausstehender Effekt modelliert, ohne `area` künstlich anzupassen. Grenzmarkierungen und Grenzverschiebungen sind unterschiedliche Vorgänge.

## Stand und weitere Arbeitspakete

Arbeitspaket 3 ergänzt Startauktionen und normale Auktionen sowie die Steuerung der Aktionsphase bis zu `ROUND_FINISHED` beziehungsweise `SCORING`. Kriegsauswertung, Kartengeometrie, tatsächliche Teilungen, Punktewertung, Web Client und Multiplayer-Server sind noch ausstehend. Tatsächlich offene Regelfragen stehen in [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md).
