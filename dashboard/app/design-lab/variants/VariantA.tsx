"use client";
/**
 * Variant A — "Command Center" — all 3 tabs interactive
 */
import { useState } from "react";
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

type Tab = "ari" | "collab" | "ivan";

const STAGE_LABELS: Record<string, string> = {
  signal: "Signal", insight: "Insight", engineering_task: "Task",
  pr_opened: "PR Open", pr_merged: "PR Merged", released: "Released",
};
const STAGE_COLORS: Record<string, string> = {
  signal: "#b58900", insight: "#2aa198", engineering_task: "#268bd2",
  pr_opened: "#6c71c4", pr_merged: "#859900", released: "#859900",
};

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="live-dot inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#859900" }} />
      <span className="font-mono-data text-xs font-semibold tracking-widest uppercase" style={{ color: "#859900" }}>Live</span>
    </span>
  );
}

function KpiStrip({ kpis, label, side }: { kpis: typeof ariKpis; label: string; side: "ari" | "ivan" }) {
  const isDark = side === "ivan";
  const accent = side === "ari" ? "#2aa198" : "#268bd2";
  const bg = isDark ? "#073642" : "#eee8d5";
  const border = isDark ? "#586e75" : "#93a1a1";
  const labelColor = isDark ? "#93a1a1" : "#586e75";
  const valueColor = isDark ? "#eee8d5" : "#073642";
  return (
    <div className="flex gap-0 border-b" style={{ backgroundColor: bg, borderColor: border }}>
      <div className="flex items-center justify-center px-4 border-r text-xs font-semibold tracking-widest uppercase"
        style={{ borderColor: border, color: accent, minWidth: 80, writingMode: "vertical-rl", transform: "rotate(180deg)", padding: "12px 8px" }}>
        {label}
      </div>
      {kpis.map((kpi) => (
        <div key={kpi.label} className="flex-1 px-4 py-3 border-r" style={{ borderColor: border }}>
          <div className="font-mono-data text-2xl font-semibold" style={{ color: valueColor }}>
            {kpi.value}
            {kpi.delta && <span className="ml-2 text-sm font-normal" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
          </div>
          <div className="text-xs mt-0.5" style={{ color: labelColor }}>
            {kpi.label} <span className="font-mono-data opacity-60">{kpi.window}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StoryPipelineRow({ story }: { story: (typeof stories)[0] }) {
  const isActive = story.status !== "released";
  return (
    <div className="border-b px-4 py-3" style={{ borderColor: "#586e75" }}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && <span className="live-dot inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#859900" }} />}
            <span className="text-sm font-medium truncate" style={{ color: "#eee8d5" }}>{story.title}</span>
          </div>
          <span className="text-xs" style={{ color: "#586e75" }}>{story.primaryBusinessArea} · started {story.startedAt}</span>
        </div>
        <div className="font-mono-data text-xs flex-shrink-0" style={{ color: "#93a1a1" }}>{Math.round(story.confidenceScore * 100)}% conf</div>
      </div>
      <div className="flex items-center gap-0">
        {story.stages.map((stage, i) => {
          const done = !!stage.completedAt;
          const color = done ? STAGE_COLORS[stage.type] : "#586e75";
          return (
            <div key={stage.type} className="flex items-center">
              <div className="w-2.5 h-2.5 rounded-full border" style={{ backgroundColor: done ? color : "transparent", borderColor: color }} />
              {i < story.stages.length - 1 && <div className="h-px w-6" style={{ backgroundColor: done ? color : "#586e75", opacity: done ? 1 : 0.4 }} />}
            </div>
          );
        })}
        <span className="ml-3 text-xs font-mono-data" style={{ color: STAGE_COLORS[story.status] || "#93a1a1" }}>{STAGE_LABELS[story.status]}</span>
      </div>
    </div>
  );
}

function EventFeed({ actor }: { actor?: "ari" | "ivan" }) {
  const events = actor ? liveEvents.filter((e) => e.actor === actor) : liveEvents;
  return (
    <div className="flex flex-col overflow-hidden" style={{ backgroundColor: "#002b36", height: "100%" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "#586e75" }}>
        <LiveDot />
        <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
          {actor ? `${actor} feed` : "handoff feed"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0 }}>
        {events.map((event) => (
          <div key={event.id} className="px-4 py-2.5 border-b" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="inline-block px-1.5 py-px text-xs font-mono-data rounded font-semibold"
                style={{ backgroundColor: event.actor === "ari" ? "#073642" : "#002b36", color: event.actor === "ari" ? "#2aa198" : "#268bd2", border: `1px solid ${event.actor === "ari" ? "#2aa198" : "#268bd2"}` }}>
                {event.actor.toUpperCase()}
              </span>
              <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{event.time}</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityList({ actor, accent }: { actor: "ari" | "ivan"; accent: string }) {
  const events = liveEvents.filter((e) => e.actor === actor);
  return (
    <div className="flex-1 overflow-y-auto dark-scroll border-r" style={{ borderColor: "#586e75" }}>
      <div className="px-4 py-2 border-b sticky top-0 z-10" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
        <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#586e75" }}>
          {actor === "ari" ? "Ari · signals & insights" : "Ivan · PRs & engineering"}
        </span>
      </div>
      {events.map((event) => (
        <div key={event.id} className="px-4 py-3 border-b" style={{ borderColor: "#073642" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block px-1.5 py-px text-xs font-mono-data rounded font-semibold"
              style={{ color: accent, border: `1px solid ${accent}`, backgroundColor: actor === "ari" ? "#073642" : "#002b36" }}>
              {event.type.replace(/_/g, " ").toUpperCase()}
            </span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{event.time}</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
        </div>
      ))}
    </div>
  );
}

function AriView() {
  return (
    <>
      <KpiStrip kpis={ariKpis} label="Ari" side="ari" />
      <div className="px-6 py-4 border-b" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
        <div className="flex items-baseline gap-6">
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#2aa198" }}>{ariKpis[0].value}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>signals captured · 7d</span></div>
          <div className="h-8 w-px" style={{ backgroundColor: "#586e75" }} />
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#b58900" }}>{ariKpis[1].value}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>insights generated · 7d</span></div>
          <div className="h-8 w-px" style={{ backgroundColor: "#586e75" }} />
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#859900" }}>{ariKpis[2].value}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>emails sent · 7d</span></div>
        </div>
      </div>
      <div className="flex" style={{ flex: 1, minHeight: 0, height: 520 }}>
        <ActivityList actor="ari" accent="#2aa198" />
        <div className="w-80 flex-shrink-0"><EventFeed actor="ari" /></div>
      </div>
    </>
  );
}

function IvanView() {
  return (
    <>
      <KpiStrip kpis={ivanKpis} label="Ivan" side="ivan" />
      <div className="px-6 py-4 border-b" style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}>
        <div className="flex items-baseline gap-6">
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#268bd2" }}>{ivanKpis[0].value}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>PRs merged · 7d</span></div>
          <div className="h-8 w-px" style={{ backgroundColor: "#586e75" }} />
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#2aa198" }}>{ivanKpis[1].value}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>avg signal → PR</span></div>
          <div className="h-8 w-px" style={{ backgroundColor: "#586e75" }} />
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#859900" }}>{ivanKpis[2].value}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>tasks completed · 7d</span></div>
        </div>
      </div>
      <div className="flex" style={{ flex: 1, minHeight: 0, height: 520 }}>
        <ActivityList actor="ivan" accent="#268bd2" />
        <div className="w-80 flex-shrink-0"><EventFeed actor="ivan" /></div>
      </div>
    </>
  );
}

function CollabView() {
  return (
    <>
      <KpiStrip kpis={ariKpis} label="Ari" side="ari" />
      <KpiStrip kpis={ivanKpis} label="Ivan" side="ivan" />
      <div className="px-6 py-4 border-b" style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}>
        <div className="flex items-baseline gap-6">
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#eee8d5" }}>{summaryStats.storiesThisWeek}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>stories shipped this week</span></div>
          <div className="h-8 w-px" style={{ backgroundColor: "#586e75" }} />
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#859900" }}>{summaryStats.loopClosedPct}%</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>loop closed</span></div>
          <div className="h-8 w-px" style={{ backgroundColor: "#586e75" }} />
          <div><span className="font-mono-data text-5xl font-semibold" style={{ color: "#2aa198" }}>{summaryStats.avgSignalToPr}</span><span className="text-sm ml-2" style={{ color: "#586e75" }}>avg signal → PR</span></div>
        </div>
      </div>
      <div className="flex" style={{ flex: 1, minHeight: 0, height: 440 }}>
        <div className="flex-1 overflow-y-auto dark-scroll border-r" style={{ borderColor: "#586e75" }}>
          <div className="px-4 py-2 border-b sticky top-0 z-10" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
            <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#586e75" }}>Stories · pipeline</span>
          </div>
          {stories.map((story) => <StoryPipelineRow key={story.id} story={story} />)}
        </div>
        <div className="w-80 flex-shrink-0"><EventFeed /></div>
      </div>
    </>
  );
}

export function VariantA() {
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
        <div className="flex items-center gap-6">
          <span className="font-mono-data text-sm font-semibold" style={{ color: "#93a1a1" }}>
            ARI <span style={{ color: "#268bd2" }}>↔</span> IVAN
          </span>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="px-3 py-1 rounded text-xs font-medium"
                style={{
                  backgroundColor: tab === t.id ? "#002b36" : "transparent",
                  color: tab === t.id ? "#eee8d5" : "#586e75",
                  border: tab === t.id ? "1px solid #586e75" : "1px solid transparent",
                  cursor: "pointer",
                }}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LiveDot />
          <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>SciSummary · public</span>
        </div>
      </div>

      {tab === "ari" && <AriView />}
      {tab === "collab" && <CollabView />}
      {tab === "ivan" && <IvanView />}
    </div>
  );
}
