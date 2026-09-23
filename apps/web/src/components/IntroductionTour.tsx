import { useState } from "react";

const SLIDES = [
  ["Gemeinsame Karte", "Ihr erschafft gemeinsam eine Karte auf dem Raster."],
  ["Gebiete ersteigern", "In den Startauktionen erhält jeder erste Gebiete."],
  ["Runden aktivieren", "Jede Runde aktiviert ihr passende Gebietskarten."],
  ["Reiche erweitern", "Danach erweitert ihr euer Reich durch Auktionen und Kriege."],
  ["Höchste Wertung", "Am Ende gewinnt die höchste Gesamtwertung."],
] as const;

export function IntroductionTour({ open, onComplete }: { readonly open: boolean; readonly onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  if (!open) return null;
  const [title, text] = SLIDES[index]!;
  const last = index === SLIDES.length - 1;
  const complete = () => { setIndex(0); onComplete(); };
  return <div className="intro-backdrop" role="dialog" aria-modal="true" aria-labelledby="intro-title">
    <section className="intro-card"><p className="eyebrow">Einführung · {index + 1} / {SLIDES.length}</p><h2 id="intro-title">{title}</h2><p>{text}</p>
      <div className="button-row"><button type="button" autoFocus className="primary-button" onClick={() => last ? complete() : setIndex((current) => current + 1)}>{last ? "Los geht’s" : "Weiter"}</button>
        <button type="button" className="text-button" onClick={complete}>Überspringen</button></div>
    </section>
  </div>;
}
