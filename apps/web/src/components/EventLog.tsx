import type { GameEvent } from "@vedras/game-core";
import { eventLabel } from "../formatters/event-label";

interface EventLogProps {
  events: readonly GameEvent[];
  playerName: (id: string) => string;
}

export function EventLog({ events, playerName }: EventLogProps) {
  const recent = events.slice(-32).reverse();
  return (
    <section className="panel event-panel" aria-labelledby="events-title">
      <div className="panel-heading"><div><p className="eyebrow">Vom Game Core</p><h2 id="events-title">Ereignisprotokoll</h2></div><span className="panel-count">{events.length} Ereignisse</span></div>
      {recent.length === 0 ? <p className="empty-state">Noch keine Ereignisse.</p> :
        <ol className="event-list" reversed>
          {recent.map((event) => <li key={event.id}>
            <span className="event-time">{new Date(event.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span>{eventLabel(event, playerName)}</span>
          </li>)}
        </ol>}
    </section>
  );
}
