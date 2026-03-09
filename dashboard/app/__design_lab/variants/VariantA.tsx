"use client";
/**
 * Variant A — "Command Center"
 * Layout: KPI strips top | pipeline timeline center | live feed right
 * Style: Solarized split — light left (Ari), dark right (Ivan), blended center
 * Typography: Inter labels, JetBrains Mono for metrics
 * Density: Information-dense, ops-room aesthetic
 */
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

const STAGE_LABELS: Record<string, string> = {
  signal: "Signal",
  insight: "Insight",
  engineering_task: "Task",
  pr_opened: "PR Open",
  pr_merged: "PR Merged",
  released: "Released",
};

const STAGE_COLORS: Record<string, string> = {
  signal: "#b58900",      // yellow
  insight: "#2aa198",     // cyan
  engineering_task: "#268bd2", // blue
  pr_opened: "#6c71c4",   // violet
  pr_merged: "#859900",   // green
  released: "#859900",    // green
};

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="live-dot inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: "#859900" }}
      />
      <span
        className="font-mono-data text-xs font-semibold tracking-widest uppercase"
        style={{ color: "#859900" }}
      >
        Live
      </span>
    </span>
  );
}

function KpiStrip({
  kpis,
  label,
  side,
}: {
  kpis: typeof ariKpis;
  label: string;
  side: "ari" | "ivan";
}) {
  const isDark = side === "ivan";
  const accent = side === "ari" ? "#2aa198" : "#268bd2";
  const bg = isDark ? "#073642" : "#eee8d5";
  const border = isDark ? "#586e75" : "#93a1a1";
  const labelColor = isDark ? "#93a1a1" : "#586e75";
  const valueColor = isDark ? "#eee8d5" : "#073642";

  return (
    <div
      className="flex gap-0 border-b"
      style={{ backgroundColor: bg, borderColor: border }}
    >
      <div
        className="flex items-center justify-center px-4 border-r text-xs font-semibold tracking-widest uppercase"
        style={{
          borderColor: border,
          color: accent,
          minWidth: 80,
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          padding: "12px 8px",
        }}
      >
        {label}
      </div>
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="flex-1 px-4 py-3 border-r"
          style={{ borderColor: border }}
        >
          <div
            className="font-mono-data text-2xl font-semibold"
            style={{ color: valueColor }}
          >
            {kpi.value}
            {kpi.delta && (
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}
              >
                {kpi.delta}
              </span>
            )}
          </div>
          <div className="text-xs mt-0.5" style={{ color: labelColor }}>
            {kpi.label}{" "}
            <span className="font-mono-data opacity-60">{kpi.window}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StoryPipelineRow({ story }: { story: (typeof stories)[0] }) {
  const completedStages = story.stages.filter((s) => s.completedAt);
  const progressPct = (completedStages.length / story.stages.length) * 100;
  const isActive = story.status !== "released";

  return (
    <div
      className="border-b px-4 py-3"
      style={{ borderColor: "#586e75" }}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && (
              <span
                className="live-dot inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: "#859900" }}
              />
            )}
            <span
              className="text-sm font-medium truncate"
              style={{ color: "#eee8d5" }}
            >
              {story.title}
            </span>
          </div>
          <span
            className="text-xs"
            style={{ color: "#586e75" }}
          >
            {story.primaryBusinessArea} · started {story.startedAt}
          </span>
        </div>
        <div
          className="font-mono-data text-xs flex-shrink-0"
          style={{ color: "#93a1a1" }}
        >
          {Math.round(story.confidenceScore * 100)}% conf
        </div>
      </div>
      {/* Pipeline stages */}
      <div className="flex items-center gap-0">
        {story.stages.map((stage, i) => {
          const done = !!stage.completedAt;
          const color = done ? STAGE_COLORS[stage.type] : "#586e75";
          return (
            <div key={stage.type} className="flex items-center">
              <div
                className="flex flex-col items-center"
                title={`${STAGE_LABELS[stage.type]}: ${stage.completedAt || "pending"}`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full border"
                  style={{
                    backgroundColor: done ? color : "transparent",
                    borderColor: color,
                  }}
                />
              </div>
              {i < story.stages.length - 1 && (
                <div
                  className="h-px w-6"
                  style={{
                    backgroundColor: done ? color : "#586e75",
                    opacity: done ? 1 : 0.4,
                  }}
                />
              )}
            </div>
          );
        })}
        <span
          className="ml-3 text-xs font-mono-data"
          style={{ color: STAGE_COLORS[story.status] || "#93a1a1" }}
        >
          {STAGE_LABELS[story.status] || story.status}
        </span>
      </div>
    </div>
  );
}

function LiveFeed() {
  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "#002b36" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: "#586e75" }}
      >
        <LiveDot />
        <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
          handoff feed
        </span>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll">
        {liveEvents.map((event) => (
          <div
            key={event.id}
            className="px-4 py-2.5 border-b"
            style={{ borderColor: "#073642" }}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="inline-block px-1.5 py-px text-xs font-mono-data rounded font-semibold"
                style={{
                  backgroundColor:
                    event.actor === "ari" ? "#073642" : "#002b36",
                  color: event.actor === "ari" ? "#2aa198" : "#268bd2",
                  border: `1px solid ${event.actor === "ari" ? "#2aa198" : "#268bd2"}`,
                }}
              >
                {event.actor.toUpperCase()}
              </span>
              <span
                className="font-mono-data text-xs"
                style={{ color: "#586e75" }}
              >
                {event.time}
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>
              {event.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VariantA() {
  return (
    <div
      className="flex flex-col h-full min-h-screen font-sans"
      style={{ backgroundColor: "#002b36", color: "#839496" }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{
          backgroundColor: "#073642",
          borderColor: "#586e75",
        }}
      >
        <div className="flex items-center gap-6">
          <span
            className="font-mono-data text-sm font-semibold"
            style={{ color: "#93a1a1" }}
          >
            ARI <span style={{ color: "#268bd2" }}>↔</span> IVAN
          </span>
          <nav className="flex items-center gap-1">
            {["Ari", "Ari ↔ Ivan", "Ivan"].map((tab) => (
              <button
                key={tab}
                className="px-3 py-1 rounded text-xs font-medium"
                style={{
                  backgroundColor:
                    tab === "Ari ↔ Ivan" ? "#002b36" : "transparent",
                  color:
                    tab === "Ari ↔ Ivan" ? "#eee8d5" : "#586e75",
                  border:
                    tab === "Ari ↔ Ivan"
                      ? "1px solid #586e75"
                      : "1px solid transparent",
                }}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LiveDot />
          <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
            SciSummary · public
          </span>
        </div>
      </div>

      {/* ── KPI Strips ── */}
      <KpiStrip kpis={ariKpis} label="Ari" side="ari" />
      <KpiStrip kpis={ivanKpis} label="Ivan" side="ivan" />

      {/* ── Hero Proof Statement ── */}
      <div
        className="px-6 py-4 border-b"
        style={{
          backgroundColor: "#002b36",
          borderColor: "#586e75",
        }}
      >
        <div className="flex items-baseline gap-6">
          <div>
            <span
              className="font-mono-data text-5xl font-semibold"
              style={{ color: "#eee8d5" }}
            >
              {summaryStats.storiesThisWeek}
            </span>
            <span className="text-sm ml-2" style={{ color: "#586e75" }}>
              stories shipped this week
            </span>
          </div>
          <div
            className="h-8 w-px"
            style={{ backgroundColor: "#586e75" }}
          />
          <div>
            <span
              className="font-mono-data text-5xl font-semibold"
              style={{ color: "#859900" }}
            >
              {summaryStats.loopClosedPct}%
            </span>
            <span className="text-sm ml-2" style={{ color: "#586e75" }}>
              loop closed
            </span>
          </div>
          <div
            className="h-8 w-px"
            style={{ backgroundColor: "#586e75" }}
          />
          <div>
            <span
              className="font-mono-data text-5xl font-semibold"
              style={{ color: "#2aa198" }}
            >
              {summaryStats.avgSignalToPr}
            </span>
            <span className="text-sm ml-2" style={{ color: "#586e75" }}>
              avg signal → PR
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex flex-1 min-h-0">
        {/* Pipeline list */}
        <div
          className="flex-1 overflow-y-auto dark-scroll border-r"
          style={{ borderColor: "#586e75" }}
        >
          <div
            className="px-4 py-2 border-b sticky top-0 z-10"
            style={{
              backgroundColor: "#073642",
              borderColor: "#586e75",
            }}
          >
            <span
              className="font-mono-data text-xs uppercase tracking-widest"
              style={{ color: "#586e75" }}
            >
              Stories · pipeline
            </span>
          </div>
          {stories.map((story) => (
            <StoryPipelineRow key={story.id} story={story} />
          ))}
        </div>

        {/* Live feed */}
        <div className="w-80 flex-shrink-0">
          <LiveFeed />
        </div>
      </div>
    </div>
  );
}
