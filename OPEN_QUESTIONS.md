# Offene Regelfragen

Die bisher erfassten Fragen zu den Startauktionen und zur Rollenverteilung bei normalen Auktionen sind geklärt.

## Geklärte Entscheidung: Zweiergleichstand

Start- und normale Auktion verwenden dieselbe Rollenregel. Referenz ist bei der Startauktion der Auktionssteller, bei der normalen Auktion der Eröffner. Ist die Referenz unter den beiden Höchstbietenden, zieht sie die Grenze. Andernfalls zieht der vom Referenzspieler aus im Uhrzeigersinn zuerst erreichte Höchstbietende. Der andere wählt zuerst. Die gemeinsame Core-Funktion `determineSplitRoles` legt beide Rollen sofort im Pending-Split fest.

Weitere offene Fragen sind für AP4 nicht erforderlich; Kriegsauswertung und Grenzverschiebungen folgen in AP5.
