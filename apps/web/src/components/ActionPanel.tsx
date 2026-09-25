import { useEffect, useRef, useState, type ReactNode } from "react";

interface ActionPanelProps {
  children: ReactNode;
  readonly setupTurn?: {
    readonly isOwnTurn: boolean;
    readonly nextActionLabel?: string;
  } | undefined;
  readonly ownTurn?: boolean | undefined;
}

export function ActionPanel({ children, setupTurn, ownTurn }: ActionPanelProps) {
  const previousOwnTurn = useRef<boolean | undefined>(undefined);
  const [turnPulse, setTurnPulse] = useState(false);
  useEffect(() => {
    if (ownTurn === true && previousOwnTurn.current !== true) {
      setTurnPulse(true);
      const timer = window.setTimeout(() => setTurnPulse(false), 560);
      previousOwnTurn.current = ownTurn;
      return () => window.clearTimeout(timer);
    }
    previousOwnTurn.current = ownTurn;
    setTurnPulse(false);
    return undefined;
  }, [ownTurn]);

  return <section className={`panel action-panel ${turnPulse ? "is-turn-pulse" : ""}`} aria-labelledby="action-title">
    {setupTurn === undefined ? <>
      <div className="panel-heading"><div><p className="eyebrow">Entscheidung</p><h2 id="action-title">Aktion</h2></div></div>
      <div className="action-content">{children}</div>
    </> : <>
      <div className="setup-turn-status" role="status" aria-live="polite">
        <h2 id="action-title">{setupTurn.isOwnTurn ? "Du bist an der Reihe." : "Du bist nicht am Zug."}</h2>
        {!setupTurn.isOwnTurn && setupTurn.nextActionLabel !== undefined && <p>Als Nächstes: <span>{setupTurn.nextActionLabel}</span></p>}
      </div>
      {setupTurn.isOwnTurn && <div className="action-content">{children}</div>}
    </>}
  </section>;
}
