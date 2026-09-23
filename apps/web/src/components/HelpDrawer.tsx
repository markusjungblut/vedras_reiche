import { useEffect, useMemo, useState } from "react";
import type { GameState } from "@vedras/game-core";
import { GLOSSARY, RULE_HELP, getCurrentHelp, getHelpValues, renderRuleHelp, type RuleHelpId } from "../help/rule-help";

type HelpTab = "CURRENT" | "RULES" | "GLOSSARY";

interface HelpDrawerProps {
  readonly state: GameState;
  readonly viewerPlayerId?: string | undefined;
  readonly open: boolean;
  readonly initialTopic?: RuleHelpId | undefined;
  readonly onClose: () => void;
  readonly onReplayIntroduction: () => void;
  readonly onResetTutorial: () => void;
}

const TAB_LABEL: Readonly<Record<HelpTab, string>> = {
  CURRENT: "Aktuelle Phase", RULES: "Alle Regeln", GLOSSARY: "Begriffe",
};

export function HelpDrawer({ state, viewerPlayerId, open, initialTopic, onClose, onReplayIntroduction, onResetTutorial }: HelpDrawerProps) {
  const [tab, setTab] = useState<HelpTab>("CURRENT");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<RuleHelpId | undefined>();
  const current = useMemo(() => getCurrentHelp(state, viewerPlayerId), [state, viewerPlayerId]);
  const values = useMemo(() => getHelpValues(state), [state]);
  useEffect(() => {
    if (!open) return;
    setTab(initialTopic === undefined ? "CURRENT" : "RULES");
    setSelectedId(initialTopic);
    setQuery("");
  }, [open, initialTopic]);
  if (!open) return null;
  const normalized = query.trim().toLocaleLowerCase("de-DE");
  const topicMatches = Object.values(RULE_HELP).filter((topic) => !normalized || [topic.title, topic.short, topic.long, ...topic.keywords]
    .join(" ").toLocaleLowerCase("de-DE").includes(normalized));
  const glossaryMatches = GLOSSARY.filter((entry) => !normalized || [entry.term, entry.definition, ...entry.keywords]
    .join(" ").toLocaleLowerCase("de-DE").includes(normalized));
  const contextTopics = current.topicIds.map((id) => RULE_HELP[id]);
  const selected = selectedId === undefined ? undefined : RULE_HELP[selectedId];
  const TopicCard = ({ id, compact = false }: { id: RuleHelpId; compact?: boolean }) => {
    const topic = renderRuleHelp(RULE_HELP[id], values);
    return <article className="help-topic" key={id}>
      <div><h3>{topic.title}</h3><p>{compact ? topic.short : topic.long}</p></div>
      {compact && <button type="button" className="text-button" onClick={() => { setTab("RULES"); setSelectedId(id); }}>Mehr erfahren</button>}
    </article>;
  };
  return <aside className="help-drawer" role="dialog" aria-modal="false" aria-labelledby="help-title">
    <div className="help-drawer-header"><div><p className="eyebrow">Regelhilfe</p><h2 id="help-title">? Hilfe</h2></div>
      <button type="button" className="text-button" aria-label="Regelhilfe schließen" onClick={onClose}>Schließen</button></div>
    <div className="help-tabs" role="tablist" aria-label="Regelhilfe-Bereiche">
      {(Object.keys(TAB_LABEL) as HelpTab[]).map((candidate) => <button key={candidate} type="button" role="tab"
        aria-selected={tab === candidate} className={tab === candidate ? "selected-button" : "secondary-button"}
        onClick={() => { setTab(candidate); setSelectedId(undefined); }}>{TAB_LABEL[candidate]}</button>)}
    </div>
    <label className="field help-search"><span>Regeln durchsuchen</span><input type="search" value={query} placeholder="z. B. Festung" onChange={(event) => setQuery(event.target.value)} /></label>
    {tab === "CURRENT" && <div className="help-content" role="tabpanel">
      <section className="current-help"><p className="section-kicker">{current.title}</p><h3>Was kann ich gerade tun?</h3><p>{current.action}</p></section>
      <section><h3 className="help-section-title">Relevante Regeln</h3>{contextTopics.map((topic) => <TopicCard key={topic.id} id={topic.id} compact />)}</section>
      <section className="suit-legend" aria-label="Symbollegende">
        <h3>Symbollegende</h3>
        {(["diamonds", "clubs", "hearts", "spades"] as const).map((id) => {
          const topic = renderRuleHelp(RULE_HELP[id], values);
          return <button type="button" key={id} className="suit-help-button" title={topic.short} aria-label={`${topic.title}: ${topic.short}`}
            onClick={() => { setTab("RULES"); setSelectedId(id); }}>{topic.title} <span>{topic.short}</span></button>;
        })}
      </section>
    </div>}
    {tab === "RULES" && <div className="help-content" role="tabpanel">
      {selected ? <><button type="button" className="text-button" onClick={() => setSelectedId(undefined)}>← Alle passenden Regeln</button><TopicCard id={selected.id} /></>
        : topicMatches.length > 0 ? topicMatches.map((topic) => <TopicCard key={topic.id} id={topic.id} compact />) : <p className="muted">Keine Regelhilfe zu „{query}“ gefunden.</p>}
    </div>}
    {tab === "GLOSSARY" && <div className="help-content" role="tabpanel">
      {glossaryMatches.length > 0 ? glossaryMatches.map((entry) => <article className="help-topic" key={entry.term}><h3>{entry.term}</h3><p>{entry.definition}</p></article>) : <p className="muted">Kein passender Begriff gefunden.</p>}
    </div>}
    <div className="help-footer"><button type="button" className="secondary-button" onClick={onReplayIntroduction}>Einführung erneut anzeigen</button>
      <button type="button" className="text-button" onClick={onResetTutorial}>Tutorialhinweise zurücksetzen</button></div>
  </aside>;
}
