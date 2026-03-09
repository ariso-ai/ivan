"use client";
/**
 * Variant C — "Live Console" — SciSummary Ari ↔ Ivan ops dashboard
 * Public-facing: specific business outcomes, real story loops, named metrics.
 */
import { useState } from "react";
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

type Tab = "ari" | "collab" | "ivan";

const STAGE_LABELS: Record<string, string> = {
  signal: "SIG", insight: "INS", engineering_task: "TASK",
  pr_opened: "PR", pr_merged: "MRG", released: "REL",
};
const STAGE_COLORS: Record<string, string> = {
  signal: "#b58900", insight: "#2aa198", engineering_task: "#268bd2",
  pr_opened: "#6c71c4", pr_merged: "#859900", released: "#859900",
};
const TYPE_LABELS: Record<string, string> = {
  signal: "SIGNAL", insight: "INSIGHT", engineering_task: "TASK",
  pr_opened: "PR OPEN", pr_merged: "MERGED", released: "SHIPPED",
};

// ─── Nav ──────────────────────────────────────────────────────────────────────
function ConsoleNavBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "ari", label: "ari" },
    { id: "collab", label: "collaboration" },
    { id: "ivan", label: "ivan" },
  ];
  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b" style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}>
      <span className="font-mono-data text-xs" style={{ color: "#2aa198" }}>$ scisummary</span>
      <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>/</span>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)}
          className="font-mono-data text-xs"
          style={{
            color: tab === t.id ? "#eee8d5" : "#586e75",
            background: "none", border: "none",
            borderBottomWidth: 1, borderBottomStyle: "solid",
            borderBottomColor: tab === t.id ? "#2aa198" : "transparent",
            cursor: "pointer", paddingBottom: 1,
          }}>
          {tab === t.id ? `[${t.label}]` : t.label}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-3">
        <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>scisummary.com</span>
        <span className="live-dot w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#859900" }} />
        <span className="font-mono-data text-xs" style={{ color: "#859900" }}>LIVE</span>
      </div>
    </div>
  );
}

// ─── KPI bar ─────────────────────────────────────────────────────────────────
function ConsoleKpiBar({ tab }: { tab: Tab }) {
  return (
    <div className="flex items-stretch border-b overflow-x-auto" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
      {/* Business health — collab only */}
      {tab === "collab" && (
        <div className="flex items-center gap-5 px-4 py-2 border-r flex-shrink-0" style={{ borderColor: "#586e75" }}>
          <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#586e75" }}>scisummary</span>
          <Stat label="MRR" value={summaryStats.mrrGrowth} color="#859900" />
          <Stat label="activation" value={summaryStats.activationRate} color="#2aa198" />
          <Stat label="AI uptime" value={summaryStats.aiJobSuccess} color="#eee8d5" />
          <Stat label="loop speed" value={summaryStats.avgSignalToPr} color="#eee8d5" />
          <Stat label="churn open" value={String(summaryStats.churnSignalsOpen)} color={summaryStats.churnSignalsOpen > 4 ? "#cb4b16" : "#859900"} />
        </div>
      )}
      {/* Ari KPIs */}
      {(tab === "ari" || tab === "collab") && (
        <div className="flex items-center gap-5 px-4 py-2 border-r flex-shrink-0" style={{ borderColor: "#586e75" }}>
          <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#2aa198" }}>ari</span>
          {ariKpis.map((k) => <Stat key={k.label} label={k.label.split(" ")[0].toLowerCase()} value={k.value} color="#eee8d5" />)}
        </div>
      )}
      {/* Ivan KPIs */}
      {(tab === "ivan" || tab === "collab") && (
        <div className="flex items-center gap-5 px-4 py-2 flex-shrink-0">
          <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#268bd2" }}>ivan</span>
          {ivanKpis.map((k) => <Stat key={k.label} label={k.label.split(" ")[0].toLowerCase()} value={k.value} color="#eee8d5" />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-mono-data text-sm font-semibold" style={{ color }}>{value}</span>
      <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{label}</span>
    </div>
  );
}

// ─── Single-actor full-width panel ───────────────────────────────────────────
function SinglePanel({ actor, accent, headline, sub }: {
  actor: "ari" | "ivan"; accent: string; headline: string; sub: string;
}) {
  const events = liveEvents.filter((e) => e.actor === actor);
  const kpis = actor === "ari" ? ariKpis : ivanKpis;
  return (
    <div className="flex" style={{ height: 740 }}>
      {/* Activity feed */}
      <div className="flex flex-col border-r" style={{ borderColor: "#586e75", backgroundColor: "#002b36", flex: 1 }}>
        <div className="px-3 py-2 border-b" style={{ borderColor: "#586e75" }}>
          <span className="font-mono-data text-xs" style={{ color: accent }}>┌─ {headline}</span>
          <span className="font-mono-data text-xs ml-3" style={{ color: "#586e75" }}>{sub}</span>
        </div>
        <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
          {events.map((event) => (
            <div key={event.id} className="px-3 py-2.5 border-b font-mono-data text-xs" style={{ borderColor: "#073642" }}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ color: accent }}>▸</span>
                <span style={{ color: "#586e75" }}>{event.time}</span>
                <span className="px-1 rounded" style={{
                  color: STAGE_COLORS[event.type] || "#93a1a1",
                  backgroundColor: `${STAGE_COLORS[event.type] || "#93a1a1"}15`,
                  fontSize: 10,
                }}>
                  {TYPE_LABELS[event.type] || event.type}
                </span>
              </div>
              <div style={{ color: "#93a1a1" }} className="pl-4 leading-relaxed">{event.text}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Metrics sidebar */}
      <div className="flex flex-col" style={{ backgroundColor: "#073642", width: 300 }}>
        <div className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#586e75", color: accent }}>
          ┌─ METRICS ─────────────────────────
        </div>
        <div className="px-3 py-3 font-mono-data text-xs flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
          <div className="mb-3 font-mono-data text-xs" style={{ color: accent }}>── 7-day KPIs ──────────────────</div>
          {kpis.map((k) => (
            <div key={k.label} className="mb-3">
              <div className="flex justify-between mb-0.5">
                <span style={{ color: "#93a1a1" }}>{k.label}</span>
                <span style={{ color: "#eee8d5" }}>
                  {k.value}
                  {k.delta && (
                    <span style={{ color: k.deltaDir === "up" ? "#859900" : k.label.includes("Churn") ? "#859900" : "#dc322f" }}>
                      {" "}{k.delta}
                    </span>
                  )}
                </span>
              </div>
              {k.context && <div style={{ color: "#586e75", fontSize: 10 }}>{k.context}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Collab: Ari left panel ───────────────────────────────────────────────────
function AriPanel() {
  const ariEvents = liveEvents.filter((e) => e.actor === "ari");
  return (
    <div className="flex flex-col border-r" style={{ borderColor: "#586e75", backgroundColor: "#002b36", height: 740 }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: "#586e75" }}>
        <div className="font-mono-data text-xs" style={{ color: "#2aa198" }}>┌─ ARI · DEMAND INTELLIGENCE</div>
        <div className="font-mono-data text-xs mt-0.5" style={{ color: "#586e75" }}>
          monitors signals · generates insights · queues Ivan's work
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {ariEvents.map((event) => (
          <div key={event.id} className="px-3 py-2.5 border-b font-mono-data text-xs" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-1">
              <span style={{ color: "#2aa198" }}>▸</span>
              <span style={{ color: "#586e75" }}>{event.time}</span>
              <span className="px-1 rounded" style={{
                color: STAGE_COLORS[event.type] || "#93a1a1",
                backgroundColor: `${STAGE_COLORS[event.type] || "#93a1a1"}15`,
                fontSize: 10,
              }}>
                {TYPE_LABELS[event.type] || event.type}
              </span>
            </div>
            <div style={{ color: "#93a1a1" }} className="pl-4 leading-relaxed">{event.text}</div>
          </div>
        ))}
        {/* Ari KPI summary at bottom of feed */}
        <div className="px-3 py-4 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-3" style={{ color: "#2aa198" }}>── Ari · 7d KPIs ──────────</div>
          {ariKpis.map((k) => (
            <div key={k.label} className="mb-2.5">
              <div className="flex justify-between">
                <span style={{ color: "#93a1a1" }}>{k.label}</span>
                <span style={{ color: "#eee8d5" }}>
                  {k.value}
                  {k.delta && (
                    <span style={{ color: k.label.includes("Churn") ? "#859900" : "#859900" }}>{" "}{k.delta}</span>
                  )}
                </span>
              </div>
              {k.context && <div style={{ color: "#586e75", fontSize: 10, marginTop: 1 }}>{k.context}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Collab: Stories pipeline ─────────────────────────────────────────────────
function StoryConsoleList() {
  return (
    <div className="flex flex-col" style={{ backgroundColor: "#073642", height: 740 }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: "#586e75" }}>
        <div className="font-mono-data text-xs" style={{ color: "#93a1a1" }}>┌─ STORIES · PIPELINE</div>
        <div className="font-mono-data text-xs mt-0.5" style={{ color: "#586e75" }}>
          {summaryStats.storiesThisWeek} active · {summaryStats.loopClosedPct}% closed this week · {summaryStats.avgSignalToPr} avg loop
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {stories.map((story) => {
          const color = STAGE_COLORS[story.status] || "#93a1a1";
          return (
            <div key={story.id} className="px-3 py-3 border-b font-mono-data" style={{ borderColor: "#586e75" }}>
              {/* Title + status */}
              <div className="flex items-start gap-2 mb-1.5">
                <span style={{ color, flexShrink: 0 }}>{story.status === "released" ? "✓" : "▶"}</span>
                <span className="text-xs leading-snug font-semibold" style={{ color: "#eee8d5" }}>{story.title}</span>
              </div>
              {/* Stage dots */}
              <div className="flex items-center gap-0.5 pl-4 mb-1.5">
                {story.stages.map((stage, i) => {
                  const done = !!stage.completedAt;
                  return (
                    <span key={stage.type}>
                      {i > 0 && <span style={{ color: "#586e75" }}>→</span>}
                      <span
                        style={{ color: done ? STAGE_COLORS[stage.type] : "#3a5050" }}
                        className="text-xs font-semibold"
                        title={stage.label}
                      >
                        {STAGE_LABELS[stage.type]}
                      </span>
                    </span>
                  );
                })}
              </div>
              {/* Business outcome if shipped */}
              {story.outcome && (
                <div className="pl-4 text-xs mb-1" style={{ color: "#859900" }}>
                  ✓ {story.outcome}
                </div>
              )}
              {/* Meta */}
              <div className="pl-4 text-xs" style={{ color: "#586e75" }}>
                {story.primaryBusinessArea}
                <span style={{ margin: "0 4px", color: "#3a5050" }}>·</span>
                conf {Math.round(story.confidenceScore * 100)}%
                <span style={{ margin: "0 4px", color: "#3a5050" }}>·</span>
                {story.startedAt}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Collab: Ivan right panel ─────────────────────────────────────────────────
function IvanPanel() {
  const ivanEvents = liveEvents.filter((e) => e.actor === "ivan");
  return (
    <div className="flex flex-col border-l" style={{ borderColor: "#586e75", backgroundColor: "#002b36", height: 740 }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: "#586e75" }}>
        <div className="font-mono-data text-xs" style={{ color: "#268bd2" }}>┌─ IVAN · ENGINEERING</div>
        <div className="font-mono-data text-xs mt-0.5" style={{ color: "#586e75" }}>
          ships code · median 0.34d open → merge · 99.2% AI job success
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {ivanEvents.map((event) => (
          <div key={event.id} className="px-3 py-2.5 border-b font-mono-data text-xs" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-1">
              <span style={{ color: "#268bd2" }}>▸</span>
              <span style={{ color: "#586e75" }}>{event.time}</span>
              <span className="px-1 rounded" style={{
                color: STAGE_COLORS[event.type] || "#6c71c4",
                backgroundColor: `${STAGE_COLORS[event.type] || "#6c71c4"}15`,
                fontSize: 10,
              }}>
                {TYPE_LABELS[event.type] || event.type}
              </span>
            </div>
            <div style={{ color: "#93a1a1" }} className="pl-4 leading-relaxed">{event.text}</div>
          </div>
        ))}
        {/* Ivan KPI summary */}
        <div className="px-3 py-4 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-3" style={{ color: "#268bd2" }}>── Ivan · 7d KPIs ──────────</div>
          {ivanKpis.map((k) => (
            <div key={k.label} className="mb-2.5">
              <div className="flex justify-between">
                <span style={{ color: "#93a1a1" }}>{k.label}</span>
                <span style={{ color: "#eee8d5" }}>
                  {k.value}
                  {k.delta && <span style={{ color: "#859900" }}>{" "}{k.delta}</span>}
                </span>
              </div>
              {k.context && <div style={{ color: "#586e75", fontSize: 10, marginTop: 1 }}>{k.context}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export function VariantC() {
  const [tab, setTab] = useState<Tab>("collab");

  return (
    <div className="flex flex-col font-mono-data" style={{ backgroundColor: "#002b36", color: "#839496", minHeight: 800 }}>
      <ConsoleNavBar tab={tab} setTab={setTab} />
      <ConsoleKpiBar tab={tab} />

      {tab === "ari" && (
        <SinglePanel
          actor="ari"
          accent="#2aa198"
          headline="ARI · DEMAND INTELLIGENCE ────────────────────────"
          sub="surfaces customer pain · quantifies business risk · queues Ivan's work"
        />
      )}

      {tab === "collab" && (
        <div className="flex" style={{ height: 740 }}>
          <div className="w-80 flex-shrink-0 overflow-hidden"><AriPanel /></div>
          <div className="flex-1 overflow-hidden"><StoryConsoleList /></div>
          <div className="w-80 flex-shrink-0 overflow-hidden"><IvanPanel /></div>
        </div>
      )}

      {tab === "ivan" && (
        <SinglePanel
          actor="ivan"
          accent="#268bd2"
          headline="IVAN · ENGINEERING ────────────────────────────────"
          sub="ships code against Ari's demand signals · 14 PRs this week · 2.4d avg loop"
        />
      )}
    </div>
  );
}
