"use client";
/**
 * Variant C — "Live Console" — all 3 tabs interactive
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
  pr_opened: "PR", pr_merged: "MERGED", released: "SHIPPED",
};

function ConsoleNavBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "ari", label: "ari" },
    { id: "collab", label: "collaboration" },
    { id: "ivan", label: "ivan" },
  ];
  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b" style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}>
      <span className="font-mono-data text-xs" style={{ color: "#2aa198" }}>$ scisummary/ari-ivan</span>
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
      <span className="font-mono-data text-xs ml-auto" style={{ color: "#586e75" }}>scisummary.com · public</span>
    </div>
  );
}

function ConsoleKpiBar({ tab }: { tab: Tab }) {
  const sysStats = tab === "collab";
  return (
    <div className="flex items-center border-b overflow-x-auto" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
      {/* Business metrics — collab only */}
      {sysStats && (
        <div className="flex items-center gap-4 px-4 py-2 border-r flex-shrink-0" style={{ borderColor: "#586e75" }}>
          <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#586e75" }}>biz</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono-data text-sm font-semibold" style={{ color: "#859900" }}>{summaryStats.mrrGrowth}</span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>mrr</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono-data text-sm font-semibold" style={{ color: "#2aa198" }}>{summaryStats.activationRate}</span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>activation</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>{summaryStats.avgSignalToPr}</span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>sig→pr</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono-data text-sm font-semibold" style={{ color: summaryStats.churnSignalsOpen > 0 ? "#cb4b16" : "#859900" }}>
              {summaryStats.churnSignalsOpen}
            </span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>churn open</span>
          </div>
        </div>
      )}
      {/* Ari KPIs */}
      {(tab === "ari" || tab === "collab") && (
        <div className="flex items-center gap-4 px-4 py-2 border-r flex-shrink-0" style={{ borderColor: "#586e75" }}>
          <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#2aa198" }}>ari</span>
          {ariKpis.map((k) => (
            <div key={k.label} className="flex items-baseline gap-1">
              <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>{k.value}</span>
              <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{k.label.split(" ")[0].toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
      {/* Ivan KPIs */}
      {(tab === "ivan" || tab === "collab") && (
        <div className="flex items-center gap-4 px-4 py-2 flex-shrink-0">
          <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#268bd2" }}>ivan</span>
          {ivanKpis.map((k) => (
            <div key={k.label} className="flex items-baseline gap-1">
              <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>{k.value}</span>
              <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{k.label.split(" ")[0].toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2 px-4 flex-shrink-0">
        <span className="live-dot w-2 h-2 rounded-full" style={{ backgroundColor: "#859900" }} />
        <span className="font-mono-data text-xs" style={{ color: "#859900" }}>LIVE</span>
      </div>
    </div>
  );
}

function SinglePanel({ actor, accent, label, subtitle }: { actor: "ari" | "ivan"; accent: string; label: string; subtitle: string }) {
  const events = liveEvents.filter((e) => e.actor === actor);
  const kpis = actor === "ari" ? ariKpis : ivanKpis;
  return (
    <div className="flex" style={{ height: 740 }}>
      {/* Activity feed */}
      <div className="flex flex-col border-r" style={{ borderColor: "#586e75", backgroundColor: "#002b36", flex: 1, height: 740 }}>
        <div className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#586e75", color: accent }}>
          ┌─ {label.toUpperCase()}:ACTIVITY ──── <span style={{ color: "#586e75" }}>{subtitle}</span>
        </div>
        <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
          {events.map((event) => (
            <div key={event.id} className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#073642" }}>
              <div className="flex items-center gap-2 mb-0.5">
                <span style={{ color: accent }}>▸</span>
                <span style={{ color: "#586e75" }}>{event.time}</span>
                <span className="uppercase" style={{ color: STAGE_COLORS[event.type] || "#93a1a1" }}>
                  [{TYPE_LABELS[event.type] || event.type}]
                </span>
              </div>
              <div style={{ color: "#839496" }} className="pl-4 leading-relaxed">{event.text}</div>
            </div>
          ))}
        </div>
      </div>
      {/* KPI panel */}
      <div className="flex flex-col" style={{ backgroundColor: "#073642", width: 280, height: 740 }}>
        <div className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#586e75", color: accent }}>
          ┌─ {label.toUpperCase()}:METRICS ──────────────────
        </div>
        <div className="px-3 py-3 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-3" style={{ color: accent }}>── KPIs (7d) ──────────</div>
          {kpis.map((k) => (
            <div key={k.label} className="flex justify-between mb-2.5">
              <span style={{ color: "#93a1a1" }}>{k.label}</span>
              <span style={{ color: "#eee8d5" }}>
                {k.value}
                {k.delta && (
                  <span style={{ color: k.deltaDir === "up" ? "#859900" : k.label === "Churn signals" ? "#859900" : "#dc322f" }}>
                    {" "}{k.delta}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AriPanel() {
  const ariEvents = liveEvents.filter((e) => e.actor === "ari");
  return (
    <div className="flex flex-col border-r" style={{ borderColor: "#586e75", backgroundColor: "#002b36", height: 740 }}>
      <div className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#586e75", color: "#2aa198" }}>
        ┌─ ARI:DEMAND ────────────────────
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {ariEvents.map((event) => (
          <div key={event.id} className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-0.5">
              <span style={{ color: "#2aa198" }}>▸</span>
              <span style={{ color: "#586e75" }}>{event.time}</span>
              <span className="uppercase" style={{ color: STAGE_COLORS[event.type] || "#93a1a1" }}>
                [{TYPE_LABELS[event.type] || event.type}]
              </span>
            </div>
            <div style={{ color: "#839496" }} className="pl-4 leading-relaxed">{event.text}</div>
          </div>
        ))}
        <div className="px-3 py-3 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-2" style={{ color: "#2aa198" }}>── KPIs (7d) ──</div>
          {ariKpis.map((k) => (
            <div key={k.label} className="flex justify-between mb-1.5">
              <span style={{ color: "#93a1a1" }}>{k.label}</span>
              <span style={{ color: "#eee8d5" }}>
                {k.value}
                {k.delta && (
                  <span style={{ color: k.deltaDir === "up" ? "#859900" : k.label === "Churn signals" ? "#859900" : "#dc322f" }}>
                    {" "}{k.delta}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StoryConsoleList() {
  return (
    <div className="flex flex-col" style={{ backgroundColor: "#073642", height: 740 }}>
      <div className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#586e75", color: "#93a1a1" }}>
        ┌─ STORIES:PIPELINE ─────────────
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {stories.map((story) => (
          <div key={story.id} className="px-3 py-2.5 border-b font-mono-data" style={{ borderColor: "#586e75" }}>
            <div className="flex items-start gap-2 mb-1.5">
              <span style={{ color: STAGE_COLORS[story.status] || "#93a1a1" }}>{story.status === "released" ? "✓" : "▶"}</span>
              <span className="text-xs leading-snug" style={{ color: "#eee8d5" }}>{story.title}</span>
            </div>
            <div className="flex items-center gap-1 pl-4">
              {story.stages.map((stage, i) => {
                const done = !!stage.completedAt;
                return (
                  <span key={stage.type}>
                    {i > 0 && <span style={{ color: "#586e75" }}>→</span>}
                    <span style={{ color: done ? STAGE_COLORS[stage.type] : "#586e75" }} className="text-xs" title={stage.label}>
                      {STAGE_LABELS[stage.type]}
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="pl-4 mt-1 text-xs" style={{ color: "#586e75" }}>
              {story.primaryBusinessArea}
              <span style={{ color: "#073642", margin: "0 4px" }}>·</span>
              conf <span style={{ color: "#93a1a1" }}>{Math.round(story.confidenceScore * 100)}%</span>
              <span style={{ color: "#073642", margin: "0 4px" }}>·</span>
              {story.startedAt}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IvanPanel() {
  const ivanEvents = liveEvents.filter((e) => e.actor === "ivan");
  return (
    <div className="flex flex-col border-l" style={{ borderColor: "#586e75", backgroundColor: "#002b36", height: 740 }}>
      <div className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#586e75", color: "#268bd2" }}>
        ┌─ IVAN:BUILD ────────────────────
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {ivanEvents.map((event) => (
          <div key={event.id} className="px-3 py-2 border-b font-mono-data text-xs" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-0.5">
              <span style={{ color: "#268bd2" }}>▸</span>
              <span style={{ color: "#586e75" }}>{event.time}</span>
              <span className="uppercase" style={{ color: STAGE_COLORS[event.type] || "#6c71c4" }}>
                [{TYPE_LABELS[event.type] || event.type}]
              </span>
            </div>
            <div style={{ color: "#839496" }} className="pl-4 leading-relaxed">{event.text}</div>
          </div>
        ))}
        <div className="px-3 py-3 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-2" style={{ color: "#268bd2" }}>── KPIs (7d) ──</div>
          {ivanKpis.map((k) => (
            <div key={k.label} className="flex justify-between mb-1.5">
              <span style={{ color: "#93a1a1" }}>{k.label}</span>
              <span style={{ color: "#eee8d5" }}>
                {k.value}
                {k.delta && <span style={{ color: "#859900" }}>{" "}{k.delta}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VariantC() {
  const [tab, setTab] = useState<Tab>("collab");

  return (
    <div className="flex flex-col font-mono-data" style={{ backgroundColor: "#002b36", color: "#839496", minHeight: 800 }}>
      <ConsoleNavBar tab={tab} setTab={setTab} />
      <ConsoleKpiBar tab={tab} />

      {tab === "ari" && (
        <SinglePanel actor="ari" accent="#2aa198" label="Ari" subtitle="demand intelligence" />
      )}

      {tab === "collab" && (
        <div className="flex" style={{ height: 740 }}>
          <div className="w-80 flex-shrink-0 overflow-hidden"><AriPanel /></div>
          <div className="flex-1 overflow-hidden"><StoryConsoleList /></div>
          <div className="w-80 flex-shrink-0 overflow-hidden"><IvanPanel /></div>
        </div>
      )}

      {tab === "ivan" && (
        <SinglePanel actor="ivan" accent="#268bd2" label="Ivan" subtitle="engineering output" />
      )}
    </div>
  );
}
