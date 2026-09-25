import { useEffect, useRef } from "react";
import type { GameEvent } from "@vedras/game-core";
import { eventLabel } from "../formatters/event-label";

interface EventLogProps {
  events: readonly GameEvent[];
  playerName: (id: string) => string;
}

/** Keeps the newest public event in view while a reader stays at the end. */
export function EventLog({ events, playerName }: EventLogProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const nearEndRef = useRef(true);
  const previousCountRef = useRef(-1);

  useEffect(() => {
    const list = scrollRef.current;
    if (list === null) return;
    if (events.length > previousCountRef.current && nearEndRef.current) list.scrollTop = list.scrollHeight;
    previousCountRef.current = events.length;
  }, [events.length]);

  return <section className="panel event-panel" aria-labelledby="events-title">
    <div className="panel-heading"><div><p className="eyebrow">Spielverlauf</p><h2 id="events-title">Ereignisprotokoll</h2></div><span className="panel-count">{events.length}</span></div>
    {events.length === 0 ? <p className="empty-state">Noch keine Ereignisse.</p> :
      <ol ref={scrollRef} className="event-list" tabIndex={0} aria-label="Ereignisprotokoll" onScroll={(event) => {
        const list = event.currentTarget;
        nearEndRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 36;
      }}>
        {events.map((event, index) => <li key={event.id} className={`event-${event.type.toLowerCase().replaceAll("_", "-")}`}>
          <strong className="event-number">#{index + 1}</strong><span>{eventLabel(event, playerName)}</span>
        </li>)}
      </ol>}
  </section>;
}
