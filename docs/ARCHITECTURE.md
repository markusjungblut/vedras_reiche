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

Eine Aktivierungsaktion nennt Spieler und Gebiet sowie die für die gewählte Fähigkeit nötigen Entscheidungen. Der Core prüft Phase, aktiven Spieler, Besitz, noch offene Aktivierung, Symbol und Ziele, bevor er einen Effekt anwendet. Ungültige Aktionen liefern einen testbaren Domain-Fehler und verändern den Eingabezustand nicht. Ereignisse mit passenden Payloads dokumentieren bestätigte Rundenstarts, Würfe, Aktivierungen, Symbolwirkungen und Phasenwechsel. UI-Texte gehören nicht in diese Fehler oder Ereignisse.

## Rundenablauf

Der Zustand hält aktuelle Runde, Höchstzahl, Phase und Startspieler. Die Reihenfolge der Spieler ist dauerhaft festgelegt. Die erste Startspielerwahl bezieht Zufall ausschließlich über die eingespeiste `RandomSource`. Nach jeder vollständig abgeschlossenen Runde folgt der nächste Spieler in dieser Reihenfolge; am Listenende beginnt sie wieder vorne. Eine neue Runde setzt nur eindeutig rundenbezogene Zustände zurück und beginnt mit der Aktivierungsphase.

```text
Runde beginnen
  → drei verschiedene Aktivierungszahlen würfeln
  → passende kontrollierte Gebiete ermitteln
  → Aktivierungsphase abwickeln
  → Aktionsphase erreichen
```

Die Aktionsphase ist in Arbeitspaket 2 ein erreichbarer Zustand. Ihr Ablauf, darunter Auktionen und Kriege, folgt später.

`startRound` ist derzeit auch aus `SETUP` aufrufbar, damit die Aktivierungsphase ohne implementierte Startauktionen getestet werden kann. Die künftige Spielsteuerung muss vor dem ersten Aufruf den Abschluss der Startauktionen sicherstellen. Ein weiterer Aufruf aus `ACTION_PHASE` setzt voraus, dass die spätere Aktionsphasenlogik diese Runde vollständig abgeschlossen hat. Diese Voraussetzung kann der Core in Arbeitspaket 2 noch nicht selbst prüfen. Nach der letzten Aktionsphase fehlen zudem noch Wertung und Spielende.

## Aktivierungsphase

Für jede der drei Zahlen wählt der erste W6 eines von sechs benachbarten Zahlenpaaren zwischen 1 und 12. Der zweite W6 wählt bei 1 bis 3 die niedrigere und bei 4 bis 6 die höhere Zahl. Ein erneut getroffenes Ergebnis wird verworfen und neu gewürfelt; die Reihenfolge der drei unterschiedlichen Ergebnisse bleibt erhalten. Kontrollierte Gebiete mit einer passenden ersten oder zweiten Aktivierungszahl werden einmal vorgemerkt, neutrale Gebiete nicht.

Die Liste wird zu Phasenbeginn festgelegt. Eine während der Phase durch ♣ neu erhaltene zweite Zahl führt erst ab der nächsten Runde zu einer zusätzlichen Aktivierung.

Die Bearbeitungsreihenfolge beginnt beim Startspieler und läuft im Uhrzeigersinn. Der Aktivierungszustand zeigt den aktuellen Spieler und dessen offene Gebiete. Bei mehreren offenen Gebieten trifft der Spieler die Auswahl; die Engine legt ihre Reihenfolge nicht fest. Erst nach gültiger Symbol- und Zielwahl sowie ausgeführter oder ausdrücklich vorgemerkter Wirkung gilt ein Gebiet als abgehandelt. Danach bleibt derselbe Spieler für seine übrigen Gebiete aktiv. Spieler ohne offene Aktivierungen werden übersprungen. Sind keine mehr offen, erzeugt der Core den Phasenwechsel zur Aktionsphase.

Die Symbolwahl berücksichtigt ein mögliches zweites Symbol. Eine Aktivierung löst genau eine der vorhandenen Fähigkeiten aus. ♣ kann zusätzlich eine zweite Aktivierungszahl oder ein zweites Symbol erzeugen; diese Spezialisierungen schließen sich gegenseitig aus, während eine Siedlung oder Stadt daneben bestehen kann. ♥ verändert globalen oder lokalen Einfluss. ♦ markiert eine gegnerische Grenze oder hält eine noch geometrisch auszuführende Verschiebung zu einem neutralen Gebiet fest. ♠ speichert Spieler, Herkunftsgebiet und Verfügbarkeit eines später einmal verwendbaren Kampfbonus.

Für die zweite ♣-Aktivierungszahl bezieht der Core die zufällig gezogene Gebietskarte aus einer eingespeisten `CardSource`. Deren Vertrag umfasst das Zurücklegen und erneute Mischen der Karte. Dieselbe Zahl wie auf der ursprünglichen Gebietskarte führt zu einem weiteren Zug.

## Rundenbezogene Effekte

Gespeicherte ♠-Aktivierungen bleiben für die laufende Runde verfügbar und können später im Krieg genau einmal verbraucht werden. Nicht genutzte Aktivierungen verfallen am Rundenende. Auch der Aktivierungsfortschritt und die drei Würfelzahlen gehören zur laufenden Runde. Der Core setzt beim Rundenwechsel nur diese eindeutig temporären Daten zurück; dauerhafte Gebiete, Entwicklungen, Einflusswerte und Grenzmarkierungen bleiben nach ihren jeweiligen Regeln erhalten. Insbesondere bleibt eine gegnerische ♦-Grenzmarkierung bis zum nächsten Krieg an dieser Grenze bestehen.

## Determinismus und Replay

Alle Zufallswerte stammen aus einer austauschbaren `RandomSource`; im Regelcode steht kein direktes `Math.random()`. Tests können eine feste Folge von W6-Werten liefern und damit auch Wiederholungswürfe prüfen. Ein späterer Server kontrolliert die Quelle. Für ein Replay müssen Ausgangszustand, Reihenfolge der Aktionen und verwendete Zufallswerte reproduzierbar sein. Das Speicherformat ist noch offen.

## Logische Nachbarschaft und Kartenraum

Gebiete kennen derzeit angrenzende Gebiete als IDs. Diese logische Nachbarschaft erlaubt, ♣-Entwicklungsziele, ♥-Einflussziele und ♦-Nachbarn zu prüfen. Eine gegnerische gemeinsame Grenze wird über ein stabiles, reihenfolgeunabhängiges Paar von Gebiets-IDs identifiziert; `A–B` und `B–A` bezeichnen dieselbe Grenze.

Die spätere Karte benötigt Rasterflächen oder Polygone. Nur damit lassen sich verschobene Kästchen, Zusammenhängigkeit, Mindestgröße, POIs und neu entstehende Nachbarschaften korrekt bestimmen. Die ♦-Verschiebung bis zu zwei Kästchen wird deshalb als ausstehender Effekt modelliert, ohne `area` künstlich anzupassen. Grenzmarkierungen und Grenzverschiebungen sind unterschiedliche Vorgänge.

## Stand und weitere Arbeitspakete

Arbeitspaket 2 umfasst Rundensteuerung und die Abwicklung der Aktivierungsphase bis zum Eintritt in die Aktionsphase. Die vollständige Aktionsphase, Auktionen, Kriege, Kartengeometrie, Web Client und Multiplayer-Server sind noch ausstehend. Tatsächlich offene Regelfragen stehen in [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md).
