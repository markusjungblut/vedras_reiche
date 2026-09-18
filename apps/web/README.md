# Visual Debug Client

Dieser React/TypeScript/Vite-Workspace macht den bestehenden `@vedras/game-core` lokal sichtbar und bedienbar. Alle regelrelevanten Entscheidungen werden durch Core-Aktionen geprüft. Demo-Karte, reproduzierbarer Seed und Schnellstart-Szenarien dienen nur der Entwicklung und sind kein Teil des Game Core.

Im Repository-Stamm starten:

```sh
npm install
npm run dev
```

Der Client ist dann gewöhnlich unter [http://localhost:5173](http://localhost:5173) erreichbar. `npm run dev:core` startet bei Bedarf zusätzlich den Core-Watch-Modus. Ein Browser-Reload setzt das lokale Demo zurück; Speichern und Multiplayer gehören nicht zu diesem Arbeitspaket.
