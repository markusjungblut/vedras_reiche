# Offene Regelfragen

Die bisher erfassten Fragen zu den Startauktionen und zur Rollenverteilung bei normalen Auktionen sind geklärt.

## Offene Produkt- und Balancingentscheidung: Standardraster

Welche festen digitalen Rasterdimensionen sollen A4 und A5 in der veröffentlichten Version standardmäßig verwenden?

Der lokale Spielaufbau verwendet bis zu dieser Entscheidung nur veränderbare technische Startwerte. Die Regel bleibt auf die Mindestflächen A4 = 20 und A5 = 10 Kästchen beschränkt.

## Geklärte Entscheidung: Zweiergleichstand

Start- und normale Auktion verwenden dieselbe Rollenregel. Referenz ist bei der Startauktion der Auktionssteller, bei der normalen Auktion der Eröffner. Ist die Referenz unter den beiden Höchstbietenden, zieht sie die Grenze. Andernfalls zieht der vom Referenzspieler aus im Uhrzeigersinn zuerst erreichte Höchstbietende. Der andere wählt zuerst. Die gemeinsame Core-Funktion `determineSplitRoles` legt beide Rollen sofort im Pending-Split fest.

## Offene technische Regelformalisierung: Schwächung nach Grenzgewinn

Die Anleitung sagt, dass das unterlegene Gebiet geschwächt wird, wenn seine Mindestgröße die sonst zulässige **vollständige Verschiebung der gemeinsamen Front** begrenzt. Die Rasterregeln legen weder eine eindeutige Zielkurve für diese vollständige Front noch fest, wie mit Einbuchtungen, seitlich abzweigenden Fronten und mehreren möglichen zusammenhängenden Grenzverläufen umzugehen ist. Die bloße Restfläche, die Anzahl übernommener Zellen oder eine geometrische Grenze allein liefern diese Ursache nicht.

`assessBorderAdvanceLimitation` kapselt die noch unbestimmte Entscheidung und liefert derzeit `determinate: false`. Bis die vollständige Front für beliebige Rastergeometrie präzise definiert ist, erzeugt ein Grenzgewinn keine neue Schwächung. Alle übrigen Regeln für bereits geschwächte Gebiete sind implementiert. Für eine spätere Entscheidung genügt eine Festlegung, welche Zellen oder Grenzlinie die „vollständige Front“ bei einem gegebenen ursprünglichen Grenzverlauf und einer erlaubten Tiefe bilden.
