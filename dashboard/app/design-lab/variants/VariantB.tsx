"use client";
/**
 * Variant B — "Story Narrative" — all 3 tabs interactive
 */
import { useState } from "react";
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

type Tab = "ari" | "collab" | "ivan";

const STAGE_DOT_COLORS: Record<string, string> = {
  signal: "#b58900", insight: "#2aa198", engineering_task: "#268bd2",
  pr_opened: "#6c71c4", pr_merged: "#859900", released: "#859900",
};
const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  signal:           { label: "Signal",    bg: "#b5890022", color: "#b58900" },
  insight:          { label: "Insight",   bg: "#2aa19822", color: "#2aa198" },
  engineering_task: { label: "Building",  bg: "#268bd222", color: "#268bd2" },
  pr_opened:        { label: "In Review", bg: "#6c71c422", color: "#6c71c4" },
  pr_merged:        { label: "Merged",    bg: "#85990022", color: "#859900" },
  released:         { label: "Shipped",   bg: "#85990033", color: "#859900" },
};

function StoryCard({ story }: { story: (typeof stories)[0] }) {
  const badge = STATUS_BADGE[story.status];
  const completedStages = story.stages.filter((s) => s.completedAt).length;
  const pct = (completedStages / story.stages.length) * 100;
  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight" style={{ color: "#eee8d5" }}>{story.title}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{story.publicSummary}</p>
      <div>
        <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: "#002b36" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: badge.color }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{completedStages}/{story.stages.length} stages</span>
          <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{story.primaryBusinessArea}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {story.stages.map((stage) => {
          const done = !!stage.completedAt;
          const color = done ? STAGE_DOT_COLORS[stage.type] : "#586e75";
          return <div key={stage.type} className="w-2 h-2 rounded-full" style={{ backgroundColor: done ? color : "transparent", border: `1.5px solid ${color}`, opacity: done ? 1 : 0.5 }} title={stage.label} />;
        })}
        <span className="ml-2 text-xs" style={{ color: "#586e75" }}>started {story.startedAt}</span>
      </div>
    </div>
  );
}

function PipelineTimeline() {
  const stages = [
    { key: "signal", label: "Customer Signal", actor: "Ari", color: "#b58900", icon: "◎" },
    { key: "insight", label: "Ari Insight", actor: "Ari", color: "#2aa198", icon: "◈" },
    { key: "engineering_task", label: "Ivan Task", actor: "Ivan", color: "#268bd2", icon: "◉" },
    { key: "pr_opened", label: "Pull Request", actor: "Ivan", color: "#6c71c4", icon: "◇" },
    { key: "pr_merged", label: "Merged", actor: "Ivan", color: "#859900", icon: "◆" },
    { key: "released", label: "Release", actor: "System", color: "#859900", icon: "★" },
  ];
  return (
    <div className="border-y px-6 py-4" style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}>
      <div className="text-xs font-mono-data uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>The Loop: customer signal → shipped release</div>
      <div className="flex items-center justify-between">
        {stages.map((stage, i) => (
          <div key={stage.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-10 h-10 rounded-full flex items-center justify-center border-2 text-base"
                style={{ borderColor: stage.color, backgroundColor: `${stage.color}22`, color: stage.color }}>{stage.icon}</div>
              <div className="text-center">
                <div className="text-xs font-medium" style={{ color: "#eee8d5" }}>{stage.label}</div>
                <div className="text-xs font-mono-data" style={{ color: stage.actor === "Ari" ? "#2aa198" : stage.actor === "Ivan" ? "#268bd2" : "#586e75" }}>{stage.actor}</div>
              </div>
            </div>
            {i < stages.length - 1 && <div className="flex-1 mx-3 h-px" style={{ backgroundColor: "#586e75", minWidth: 24 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniKpiRow({ label, kpis, accentColor }: { label: string; kpis: typeof ariKpis; accentColor: string }) {
  return (
    <div className="flex items-center gap-6 px-6 py-3" style={{ backgroundColor: "#073642" }}>
      <span className="font-mono-data text-xs font-semibold uppercase tracking-widest" style={{ color: accentColor, minWidth: 32 }}>{label}</span>
      {kpis.map((kpi) => (
        <div key={kpi.label} className="flex items-baseline gap-1.5">
          <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>{kpi.value}</span>
          {kpi.delta && <span className="font-mono-data text-xs" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
          <span className="text-xs" style={{ color: "#586e75" }}>{kpi.label}</span>
        </div>
      ))}
    </div>
  );
}

function LiveSidebar({ actor }: { actor?: "ari" | "ivan" }) {
  const events = actor ? liveEvents.filter((e) => e.actor === actor) : liveEvents;
  return (
    <div className="w-72 border-l flex flex-col" style={{ borderColor: "#586e75" }}>
      <div className="px-4 py-3 border-b font-mono-data text-xs uppercase tracking-widest" style={{ borderColor: "#586e75", color: "#586e75" }}>
        {actor ? `${actor} activity` : "Live Handoff Feed"}
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {events.map((event) => (
          <div key={event.id} className="px-4 py-3 border-b" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono-data font-semibold" style={{ color: event.actor === "ari" ? "#2aa198" : "#268bd2" }}>{event.actor.toUpperCase()}</span>
              <span className="text-xs" style={{ color: "#586e75" }}>{event.time}</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ari wallboard ─────────────────────────────────────────────────────────────
function AriView() {
  return (
    <>
      <div className="px-6 py-8 text-center border-b" style={{ borderColor: "#586e75" }}>
        <h1 className="text-4xl font-bold mb-2" style={{ color: "#eee8d5" }}>
          <span style={{ color: "#2aa198" }}>Ari</span> is the operator layer.
        </h1>
        <p className="text-base" style={{ color: "#839496" }}>
          <span className="font-mono-data" style={{ color: "#2aa198" }}>{ariKpis[0].value}</span> signals ·{" "}
          <span className="font-mono-data" style={{ color: "#b58900" }}>{ariKpis[1].value}</span> insights ·{" "}
          <span className="font-mono-data" style={{ color: "#859900" }}>{ariKpis[3].value}</span> conversion signals this week
        </p>
      </div>
      <MiniKpiRow label="Ari" kpis={ariKpis} accentColor="#2aa198" />
      <div className="flex flex-1" style={{ minHeight: 0, height: 500 }}>
        <div className="flex-1 p-6 overflow-y-auto dark-scroll">
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>Ari · demand signals</div>
          <div className="grid grid-cols-2 gap-4">
            {ariKpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border p-4" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
                <div className="font-mono-data text-3xl font-semibold mb-1" style={{ color: "#2aa198" }}>
                  {kpi.value}
                  {kpi.delta && <span className="ml-2 text-base" style={{ color: "#859900" }}>{kpi.delta}</span>}
                </div>
                <div className="text-xs" style={{ color: "#839496" }}>{kpi.label} <span className="font-mono-data" style={{ color: "#586e75" }}>{kpi.window}</span></div>
              </div>
            ))}
          </div>
        </div>
        <LiveSidebar actor="ari" />
      </div>
    </>
  );
}

// ── Ivan wallboard ────────────────────────────────────────────────────────────
function IvanView() {
  return (
    <>
      <div className="px-6 py-8 text-center border-b" style={{ borderColor: "#586e75" }}>
        <h1 className="text-4xl font-bold mb-2" style={{ color: "#eee8d5" }}>
          <span style={{ color: "#268bd2" }}>Ivan</span> is the engineering layer.
        </h1>
        <p className="text-base" style={{ color: "#839496" }}>
          <span className="font-mono-data" style={{ color: "#268bd2" }}>{ivanKpis[0].value}</span> PRs merged ·{" "}
          <span className="font-mono-data" style={{ color: "#2aa198" }}>{ivanKpis[1].value}</span> avg signal→PR ·{" "}
          <span className="font-mono-data" style={{ color: "#859900" }}>{ivanKpis[2].value}</span> tasks completed
        </p>
      </div>
      <MiniKpiRow label="Ivan" kpis={ivanKpis} accentColor="#268bd2" />
      <div className="flex flex-1" style={{ minHeight: 0, height: 500 }}>
        <div className="flex-1 p-6 overflow-y-auto dark-scroll">
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>Ivan · engineering output</div>
          <div className="grid grid-cols-2 gap-4">
            {ivanKpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border p-4" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
                <div className="font-mono-data text-3xl font-semibold mb-1" style={{ color: "#268bd2" }}>
                  {kpi.value}
                  {kpi.delta && <span className="ml-2 text-base" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
                </div>
                <div className="text-xs" style={{ color: "#839496" }}>{kpi.label} <span className="font-mono-data" style={{ color: "#586e75" }}>{kpi.window}</span></div>
              </div>
            ))}
          </div>
        </div>
        <LiveSidebar actor="ivan" />
      </div>
    </>
  );
}

// ── Collab view ───────────────────────────────────────────────────────────────
function CollabView() {
  return (
    <>
      <div className="px-6 py-8 text-center border-b" style={{ borderColor: "#586e75" }}>
        <h1 className="text-5xl font-bold mb-2" style={{ color: "#eee8d5" }}>
          <span style={{ color: "#2aa198" }}>Ari</span> captures demand.{" "}
          <span style={{ color: "#268bd2" }}>Ivan</span> ships it.
        </h1>
        <p className="text-base" style={{ color: "#839496" }}>
          {summaryStats.storiesThisWeek} stories closed this week ·{" "}
          <span className="font-mono-data" style={{ color: "#859900" }}>{summaryStats.loopClosedPct}%</span> loop closed · avg{" "}
          <span className="font-mono-data" style={{ color: "#eee8d5" }}>{summaryStats.avgSignalToPr}</span> signal-to-PR
        </p>
      </div>
      <PipelineTimeline />
      <MiniKpiRow label="Ari" kpis={ariKpis} accentColor="#2aa198" />
      <div style={{ height: 1, backgroundColor: "#586e75" }} />
      <MiniKpiRow label="Ivan" kpis={ivanKpis} accentColor="#268bd2" />
      <div className="flex flex-1" style={{ minHeight: 0, height: 420 }}>
        <div className="flex-1 p-6 overflow-y-auto dark-scroll">
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>Active Stories</div>
          <div className="grid grid-cols-2 gap-4">
            {stories.map((story) => <StoryCard key={story.id} story={story} />)}
          </div>
        </div>
        <LiveSidebar />
      </div>
    </>
  );
}

export function VariantB() {
  const [tab, setTab] = useState<Tab>("collab");
  const tabs = [
    { id: "ari" as Tab, label: "Ari" },
    { id: "collab" as Tab, label: "Ari ↔ Ivan" },
    { id: "ivan" as Tab, label: "Ivan" },
  ];

  return (
    <div className="flex flex-col font-sans" style={{ backgroundColor: "#002b36", color: "#839496", minHeight: 860 }}>
      {/* Nav */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
        <nav className="flex items-center gap-4">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-sm font-medium"
              style={{
                color: tab === t.id ? "#eee8d5" : "#586e75",
                borderBottom: tab === t.id ? "2px solid #268bd2" : "2px solid transparent",
                paddingBottom: 2, background: "none", border: "none",
                borderBottomWidth: 2, borderBottomStyle: "solid",
                borderBottomColor: tab === t.id ? "#268bd2" : "transparent",
                cursor: "pointer",
              }}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className="live-dot w-2 h-2 rounded-full inline-block" style={{ backgroundColor: "#859900" }} />
          <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>live · SciSummary</span>
        </div>
      </div>

      {tab === "ari" && <AriView />}
      {tab === "collab" && <CollabView />}
      {tab === "ivan" && <IvanView />}
    </div>
  );
}
