"use client";
/**
 * Variant E — "Wallboard"
 * Layout: Full-bleed top hero number | wide pipeline stages | bottom grid (3 columns)
 * Style: Solarized Dark dominant, strong accent color use for visual scan
 * Typography: Giant display numbers, clean condensed labels
 * Density: Information-dense + viral-ready hero numbers designed for screenshots
 */
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

const STAGE_COLORS: Record<string, string> = {
  signal: "#b58900",
  insight: "#2aa198",
  engineering_task: "#268bd2",
  pr_opened: "#6c71c4",
  pr_merged: "#859900",
  released: "#859900",
};

const STAGE_ICONS: Record<string, string> = {
  signal: "◎",
  insight: "◈",
  engineering_task: "⬡",
  pr_opened: "⊙",
  pr_merged: "◆",
  released: "★",
};

function HeroBanner() {
  return (
    <div
      className="relative overflow-hidden"
      style={{ backgroundColor: "#073642" }}
    >
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, #839496 0, #839496 1px, transparent 0, transparent 50%),repeating-linear-gradient(90deg, #839496 0, #839496 1px, transparent 0, transparent 50%)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 px-8 py-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <nav className="flex items-center gap-4">
                {["Ari", "Ari ↔ Ivan", "Ivan"].map((tab) => (
                  <button
                    key={tab}
                    className="text-sm font-medium"
                    style={{
                      color:
                        tab === "Ari ↔ Ivan" ? "#eee8d5" : "#586e75",
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </nav>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="live-dot w-2 h-2 rounded-full"
              style={{ backgroundColor: "#859900" }}
            />
            <span className="font-mono-data text-xs" style={{ color: "#859900" }}>
              LIVE · SciSummary
            </span>
          </div>
        </div>

        {/* Giant hero numbers */}
        <div className="flex items-end gap-12">
          <div>
            <div
              className="font-mono-data leading-none"
              style={{ fontSize: 96, fontWeight: 700, color: "#eee8d5" }}
            >
              {summaryStats.storiesThisWeek}
            </div>
            <div className="text-lg font-medium mt-1" style={{ color: "#586e75" }}>
              stories closed this week
            </div>
          </div>
          <div className="mb-4">
            <div
              className="font-mono-data leading-none"
              style={{ fontSize: 64, fontWeight: 600, color: "#859900" }}
            >
              {summaryStats.loopClosedPct}%
            </div>
            <div className="text-sm" style={{ color: "#586e75" }}>
              loop closed
            </div>
          </div>
          <div className="mb-4">
            <div
              className="font-mono-data leading-none"
              style={{ fontSize: 64, fontWeight: 600, color: "#2aa198" }}
            >
              {summaryStats.avgSignalToPr}
            </div>
            <div className="text-sm" style={{ color: "#586e75" }}>
              signal → PR
            </div>
          </div>
          <div className="mb-4 ml-auto text-right">
            <p
              className="text-sm max-w-xs leading-relaxed"
              style={{ color: "#839496" }}
            >
              <span style={{ color: "#2aa198" }}>Ari</span> captures customer demand.{" "}
              <span style={{ color: "#268bd2" }}>Ivan</span> engineers the response.
              <br />
              Every metric is live, every story is real.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WideTimeline() {
  const stages = [
    { key: "signal", label: "Customer Signal", actor: "Ari" },
    { key: "insight", label: "Ari Insight", actor: "Ari" },
    { key: "engineering_task", label: "Engineering Task", actor: "Ivan" },
    { key: "pr_opened", label: "Pull Request", actor: "Ivan" },
    { key: "pr_merged", label: "PR Merged", actor: "Ivan" },
    { key: "released", label: "Live Release", actor: "System" },
  ];

  const activeStages = stories.reduce((acc, story) => {
    story.stages.forEach((s) => {
      if (s.completedAt) acc.add(s.type);
    });
    return acc;
  }, new Set<string>());

  return (
    <div
      className="border-y"
      style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}
    >
      <div className="px-8 py-5">
        <div className="flex items-center justify-between">
          {stages.map((stage, i) => {
            const color = STAGE_COLORS[stage.key];
            const active = activeStages.has(stage.key);
            return (
              <div key={stage.key} className="flex items-center flex-1">
                <div className="flex flex-col items-start gap-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex items-center justify-center rounded-full text-lg"
                      style={{
                        width: 36,
                        height: 36,
                        backgroundColor: active ? `${color}22` : "#073642",
                        border: `2px solid ${active ? color : "#586e75"}`,
                        color: active ? color : "#586e75",
                      }}
                    >
                      {STAGE_ICONS[stage.key]}
                    </div>
                    <div>
                      <div
                        className="text-xs font-medium"
                        style={{ color: active ? "#eee8d5" : "#586e75" }}
                      >
                        {stage.label}
                      </div>
                      <div
                        className="font-mono-data text-xs"
                        style={{
                          color:
                            stage.actor === "Ari"
                              ? "#2aa198"
                              : stage.actor === "Ivan"
                              ? "#268bd2"
                              : "#586e75",
                        }}
                      >
                        {stage.actor}
                      </div>
                    </div>
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <div className="flex-1 mx-3 h-px" style={{ backgroundColor: "#586e75" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StoriesGrid() {
  return (
    <div className="p-6">
      <div
        className="font-mono-data text-xs uppercase tracking-widest mb-4"
        style={{ color: "#586e75" }}
      >
        Recent Stories
      </div>
      <div className="grid grid-cols-5 gap-3">
        {stories.map((story) => {
          const color = STAGE_COLORS[story.status] || "#93a1a1";
          const pct =
            (story.stages.filter((s) => s.completedAt).length / story.stages.length) * 100;
          return (
            <div
              key={story.id}
              className="rounded-lg p-3 border"
              style={{
                backgroundColor: "#073642",
                borderColor: "#586e75",
                borderTopColor: color,
                borderTopWidth: 2,
              }}
            >
              <div className="text-xs font-medium mb-2 leading-snug" style={{ color: "#eee8d5" }}>
                {story.title}
              </div>
              <div
                className="h-0.5 rounded-full mb-2 overflow-hidden"
                style={{ backgroundColor: "#002b36" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <div className="flex justify-between items-center">
                <span className="font-mono-data text-xs" style={{ color }}>
                  {story.status === "released" ? "✓ Shipped" : story.status.replace("_", " ")}
                </span>
                <span className="text-xs" style={{ color: "#586e75" }}>
                  {story.startedAt}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AriKpiPanel() {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "#586e75" }}
    >
      <div
        className="px-4 py-2.5 border-b flex items-center gap-2"
        style={{ backgroundColor: "#073642", borderColor: "#586e75" }}
      >
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#2aa198" }} />
        <span className="text-xs font-semibold" style={{ color: "#2aa198" }}>
          Ari · Operator
        </span>
      </div>
      <div style={{ backgroundColor: "#002b36" }}>
        {ariKpis.map((kpi, i) => (
          <div
            key={kpi.label}
            className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ borderColor: "#073642" }}
          >
            <span className="text-xs" style={{ color: "#839496" }}>
              {kpi.label}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>
                {kpi.value}
              </span>
              {kpi.delta && (
                <span
                  className="font-mono-data text-xs"
                  style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}
                >
                  {kpi.delta}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IvanKpiPanel() {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "#586e75" }}
    >
      <div
        className="px-4 py-2.5 border-b flex items-center gap-2"
        style={{ backgroundColor: "#073642", borderColor: "#586e75" }}
      >
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#268bd2" }} />
        <span className="text-xs font-semibold" style={{ color: "#268bd2" }}>
          Ivan · Engineer
        </span>
      </div>
      <div style={{ backgroundColor: "#002b36" }}>
        {ivanKpis.map((kpi) => (
          <div
            key={kpi.label}
            className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ borderColor: "#073642" }}
          >
            <span className="font-mono-data text-xs" style={{ color: "#839496" }}>
              {kpi.label}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>
                {kpi.value}
              </span>
              {kpi.delta && (
                <span
                  className="font-mono-data text-xs"
                  style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}
                >
                  {kpi.delta}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveFeedPanel() {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "#586e75" }}
    >
      <div
        className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ backgroundColor: "#073642", borderColor: "#586e75" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="live-dot w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#859900" }}
          />
          <span className="text-xs font-semibold" style={{ color: "#859900" }}>
            Live Handoff Feed
          </span>
        </div>
      </div>
      <div
        className="overflow-y-auto dark-scroll"
        style={{ backgroundColor: "#002b36", maxHeight: 260 }}
      >
        {liveEvents.map((event) => (
          <div
            key={event.id}
            className="px-4 py-2.5 border-b"
            style={{ borderColor: "#073642" }}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="font-mono-data text-xs font-semibold"
                style={{
                  color: event.actor === "ari" ? "#2aa198" : "#268bd2",
                }}
              >
                {event.actor.toUpperCase()}
              </span>
              <span className="text-xs" style={{ color: "#586e75" }}>
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

export function VariantE() {
  return (
    <div
      className="flex flex-col min-h-screen font-sans"
      style={{ backgroundColor: "#002b36", color: "#839496" }}
    >
      <HeroBanner />
      <WideTimeline />
      <StoriesGrid />

      {/* Bottom panels */}
      <div className="grid grid-cols-3 gap-4 px-6 pb-6">
        <AriKpiPanel />
        <LiveFeedPanel />
        <IvanKpiPanel />
      </div>
    </div>
  );
}
