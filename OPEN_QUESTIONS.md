# Offene Regelfragen

Derzeit sind keine spielmechanischen Regelfragen bekannt.

## Festgelegtes digitales Regelprofil

- Das normale Browser-Spiel verwendet ein Raster von `50 × 50` Zellen.
- Ein Gebiet benötigt mindestens 20 Zellen; der Durchbruch beginnt ab 40 Verliererzellen.
- Die Karte ist auch während des Kartenbaus vollständig belegt: Jede Zelle gehört zu genau einer temporären Setup-Region. Dauerhafte TerritoryIds und Gebietskarten entstehen erst bei der Finalisierung.
- Der Setup-Zugzeiger läuft über Zeichen- und POI-Phasen hinweg durchgehend weiter.
- Jede Rasterzelle darf höchstens einen POI tragen.
- Wertungen bleiben intern exakte Hundertstel; die Siegerehrung zeigt gerundete ganze Punkte.
- Exakt gleiche Höchstwerte bedeuten einen gemeinsamen Sieg.
- Fraktionen bleiben bis zum Spielende geheim und werden bei `FINISHED` aufgedeckt.

## Geklärte Entscheidung: Zweiergleichstand

Start- und normale Auktion verwenden dieselbe Rollenregel. Referenz ist bei der Startauktion der Auktionssteller, bei der normalen Auktion der Eröffner. Ist die Referenz unter den beiden Höchstbietenden, zieht sie die Grenze. Andernfalls zieht der vom Referenzspieler aus im Uhrzeigersinn zuerst erreichte Höchstbietende. Der andere wählt zuerst. Die gemeinsame Core-Funktion `determineSplitRoles` legt beide Rollen sofort im Pending-Split fest.

## Geklärte Entscheidung: Schwächung nach Grenzgewinn

`assessBorderAdvanceLimitation` bestimmt aus der ursprünglichen gemeinsamen Grenze und der effektiven Kampftiefe den vollständigen Frontstreifen per orthogonaler BFS im ursprünglichen Verlierergebiet. Bleiben danach weniger als 20 Zellen, wird der Verlierer geschwächt. Die gewählte tatsächliche Übernahme beeinflusst diese Entscheidung nicht. Ein nur geometrisch nicht vollständig verschiebbarer Streifen setzt keine Schwächung.
