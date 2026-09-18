import type { ReactNode } from "react";

interface ActionPanelProps {
  children: ReactNode;
}

export function ActionPanel({ children }: ActionPanelProps) {
  return <section className="panel action-panel" aria-labelledby="action-title">
    <div className="panel-heading"><div><p className="eyebrow">Entscheidung</p><h2 id="action-title">Aktion</h2></div></div>
    <div className="action-content">{children}</div>
  </section>;
}
