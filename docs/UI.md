# UI-Leitlinien

Die Weboberfläche ist die sichtbare Spielansicht des Game Core. Sie entscheidet keine Regeln und zeigt nur Daten, die in der jeweiligen Spielansicht vorhanden sind.

## Visuelle Grundlage

Die zentralen CSS-Variablen in `apps/web/src/styles.css` definieren Flächen, Textfarben, sechs Spielerfarben, Abstände, Rundungen, Schatten, Ebenen und kurze Übergänge. Die Karte hat Vorrang; Bedienung und Informationen stehen in begleitenden Panels.

Spielerfarben erscheinen immer zusammen mit Namen, Positionsnummer, Punkt oder Status. Dadurch bleiben Besitzstände auch ohne reine Farbwahrnehmung unterscheidbar.

## Karte und Bewegung

Die Karte bleibt SVG-basiert. Zellen, Grenzen, Nachbarschaften und Labels folgen der Map-Geometrie aus dem Game Core. Für größere Karten werden Zellen und Grenzsegmente in der Kartenansicht zwischengespeichert, damit Hover und Zoom keine wiederholten Gebietssuchen pro Zelle auslösen.

Die Kartenansichten `Gebiete`, `Mein Reich`, `Reiche` und `Boni` sind lokale Anzeigeoptionen und senden keine Spielaktion. Gebiete erhalten ihre Farbe aus einer stabilen Gebiet-ID-Zuordnung; Besitzfarben dienen der Reichsansicht. Strategische Punkte sind per Maus, Tastatur und Touch erreichbar; ihre Beschreibung zeigt die jeweils gültige Regelwirkung.

Mehrspieleransichten richten aktive Bedienelemente ausschließlich nach dem vom Core projizierten persönlichen Eingabezustand. Öffentliche Fortschritte wie die Zahl abgegebener Gebote bleiben sichtbar, fremde Gebotswerte und fremde Eingabeformulare nicht.

## Desktop-Spielansicht

Auf breiten Bildschirmen steht die persönliche Spalte links neben der Karte. Aktion und Spielerübersicht liegen rechts nebeneinander; das Ereignisprotokoll nutzt die Breite beider Boxen darunter. Die Karte wird dafür nicht zugunsten von Seitenpanels verkleinert. Bei mittleren und kleinen Breiten ordnen sich die Panels kontrolliert untereinander an.

Die Gebietsübersicht folgt als eigener Abschnitt unter dem Spieltisch. Besitzerfilter und Sortierungen nach Gebiet, Symbol oder Fläche sind lokaler UI-Zustand. Die Karte lässt sich nach dem Hineinzoomen direkt ziehen. Ein Gebietsklick bleibt bis zur kleinen Drag-Schwelle ein Klick. Nachbarn behalten bei Auswahl ihre Grundfarbe und werden nur daraus abgeleitet abgedunkelt.

Übergänge sind kurz und rein visuell. `prefers-reduced-motion` schaltet Animationen und Übergänge praktisch aus.

## Einstellungen

Die Ton-Schaltfläche speichert nur die lokale Browser-Präferenz. Das kleine Web-Audio-System wird erst nach einer Benutzereingabe aktiviert und erzeugt keine Spielentscheidungen oder Netzwerkaktionen.

Das Ereignisprotokoll kann ebenfalls lokal eingeklappt werden. Beide Einstellungen gelten nur für den jeweiligen Browser.
