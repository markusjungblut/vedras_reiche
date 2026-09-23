# Offene Regelfragen

Derzeit sind keine spielmechanischen Regelfragen bekannt.

## Festgelegtes digitales Regelprofil

- Das normale Browser-Spiel startet mit einem Raster von `50 × 50` Zellen; Mehrspielerräume können vor dem Start eine andere technisch zulässige Größe wählen.
- Für digitale Karten gilt dynamisch `minimumTerritoryArea = ceil(Breite × Höhe × 1 %)`. Die Durchbruchsschwelle ist stets `minimumTerritoryArea × 2`. Beispiele: `50 × 50 → 25 / 50`, `100 × 50 → 50 / 100`, `50 × 25 → 13 / 26`.
- Räumliche Rastertiefen verwenden `scaleGridDepth(base, map) = max(1, round(base × sqrt(Kartenfläche / 2500)))`; der Basiswert `0` bleibt `0`. Das gilt für ♦ gegen neutrale Gebiete, Kriegsgewinne, starke Vorstöße, ♦-modifizierte Kriegsgewinne und die ♦-Korrektur nach Cut-and-Choose.
- Nach jeder direkten Grenzübertragung bleibt die eindeutige größte Restkomponente beim bisherigen Territory. Kleinere abgetrennte Restkomponenten fallen automatisch an den Empfänger; bei gleich großen größten Komponenten ist die Übertragung ungültig. Zellgebundene POIs und Entwicklungen folgen dabei ihrer Zelle.
- Bei einem unaufgelösten normalen Höchstgleichstand bleiben Einflusswerte erhalten, während die verwendeten Grundgebote nur der beteiligten Höchstbieter erschöpfen. Das gilt auch für einen nachweislich unmöglichen normalen Zweiwege-Split; Startauktionen bleiben unverändert.
- Die Karte ist auch während des Kartenbaus vollständig belegt: Jede Zelle gehört zu genau einer temporären Setup-Region. Dauerhafte TerritoryIds und Gebietskarten entstehen erst bei der Finalisierung.
- Der Setup-Zugzeiger läuft über Zeichen- und POI-Phasen hinweg durchgehend weiter.
- Jede Rasterzelle darf höchstens einen POI tragen.
- Wertungen bleiben intern exakte Hundertstel; die Siegerehrung zeigt gerundete ganze Punkte.
- Exakt gleiche Höchstwerte bedeuten einen gemeinsamen Sieg.
- Fraktionen bleiben bis zum Spielende geheim und werden bei `FINISHED` aufgedeckt.

## Geklärte Entscheidung: Zweiergleichstand

Start- und normale Auktion verwenden dieselbe Rollenregel. Referenz ist bei der Startauktion der Auktionssteller, bei der normalen Auktion der Eröffner. Ist die Referenz unter den beiden Höchstbietenden, zieht sie die Grenze. Andernfalls zieht der vom Referenzspieler aus im Uhrzeigersinn zuerst erreichte Höchstbietende. Der andere wählt zuerst. Die gemeinsame Core-Funktion `determineSplitRoles` legt beide Rollen sofort im Pending-Split fest.

## Geklärte Entscheidung: Schwächung nach Grenzgewinn

`assessBorderAdvanceLimitation` bestimmt aus der ursprünglichen gemeinsamen Grenze und der effektiven Kampftiefe den vollständigen Frontstreifen per orthogonaler BFS im ursprünglichen Verlierergebiet. Der Topologie-Resolver bewertet diesen Streifen mit automatischen Annexionszellen. Bleibt die eindeutige Hauptkomponente danach unter der dynamischen Mindestfläche der aktuellen Karte, wird der Verlierer geschwächt. Die gewählte tatsächliche Übernahme beeinflusst diese Entscheidung nicht. Ein nur geometrisch nicht vollständig verschiebbarer oder topologisch mehrdeutiger Streifen setzt keine Schwächung.
