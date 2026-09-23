import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@vedras/game-core";
import { eventLabel } from "../formatters/event-label";

interface EventLogProps {
  events: readonly GameEvent[];
  playerName: (id: string) => string;
}

export function EventLog({ events, playerName }: EventLogProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const nearEndRef = useRef(true);
  const previousCountRef = useRef(-1);
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("vedras-reiche-event-log-open") !== "false"; } catch { return true; }
  });

  const toggle = () => setOpen((current) => {
    const next = !current;
    try { localStorage.setItem("vedras-reiche-event-log-open", String(next)); } catch { /* Local preferences are optional. */ }
    return next;
  });

  useEffect(() => {
    const list = scrollRef.current;
    if (list === null) return;
    if (events.length > previousCountRef.current && nearEndRef.current) list.scrollTop = list.scrollHeight;
    previousCountRef.current = events.length;
  }, [events.length]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return new Intl.DateTimeFormat("de-DE", isToday
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  };
  return (
    <section className="panel event-panel" aria-labelledby="events-title">
      <div className="panel-heading"><div><p className="eyebrow">Spielverlauf</p><h2 id="events-title">Ereignisprotokoll</h2></div><span className="panel-count">{events.length} Ereignisse</span><button type="button" className="text-button event-log-toggle" aria-expanded={open} onClick={toggle}>{open ? "Einklappen" : "Anzeigen"}</button></div>
      {!open ? <p className="empty-state">Ereignisprotokoll eingeklappt.</p> : events.length === 0 ? <p className="empty-state">Noch keine Ereignisse.</p> :
        <ol ref={scrollRef} className="event-list" onScroll={(event) => {
          const list = event.currentTarget;
          nearEndRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 36;
        }}>
          {events.map((event) => <li key={event.id} className={`event-${event.type.toLowerCase().replaceAll("_", "-")}`}>
            <span className="event-time">{formatTime(event.timestamp)}</span>
            <span>{eventLabel(event, playerName)}</span>
          </li>)}
        </ol>}
    </section>
  );
}
