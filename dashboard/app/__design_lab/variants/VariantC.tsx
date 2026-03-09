"use client";
/**
 * Variant C — "Live Console"
 * Layout: Dense header row | full-height 3-panel split (Ari feed | stories | Ivan feed)
 * Style: Full Solarized Dark, terminal aesthetic with cyan/green accents
 * Typography: 100% monospace — ops room feel
 * Density: Maximum density — every pixel carries data
 */
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

const STAGE_LABELS: Record<string, string> = {
  signal: "SIG",
  insight: "INS",
  engineering_task: "TASK",
  pr_opened: "PR",
  pr_merged: "MRG",
  released: "REL",
};

const STAGE_COLORS: Record<string, string> = {
  signal: "#b58900",
  insight: "#2aa198",
  engineering_task: "#268bd2",
  pr_opened: "#6c71c4",
  pr_merged: "#859900",
  released: "#859900",
};

function ConsoleKpiBar() {
  return (
    <div
      className="flex items-center border-b overflow-x-auto"
      style={{ backgroundColor: "#073642", borderColor: "#586e75" }}
    >
      {/* Global stats */}
      <div
        className="flex items-center gap-4 px-4 py-2 border-r flex-shrink-0"
        style={{ borderColor: "#586e75" }}
      >
        <span
          className="font-mono-data text-xs uppercase tracking-widest"
          style={{ color: "#586e75" }}
        >
          sys
        </span>
        <span className="font-mono-data text-sm" style={{ color: "#859900" }}>
          {summaryStats.storiesThisWeek} stories
        </span>
        <span className="font-mono-data text-sm" style={{ color: "#2aa198" }}>
          {summaryStats.loopClosedPct}% closed
        </span>
        <span className="font-mono-data text-sm" style={{ color: "#eee8d5" }}>
          {summaryStats.avgSignalToPr} avg
        </span>
      </div>

      {/* Ari KPIs */}
      <div
        className="flex items-center gap-4 px-4 py-2 border-r flex-shrink-0"
        style={{ borderColor: "#586e75" }}
      >
        <span
          className="font-mono-data text-xs uppercase tracking-widest"
          style={{ color: "#2aa198" }}
        >
          ari
        </span>
        {ariKpis.map((k) => (
          <div key={k.label} className="flex items-baseline gap-1">
            <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>
              {k.value}
            </span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
              {k.label.split(" ")[0].toLowerCase()}
            </span>
          </div>
        ))}
      </div>

      {/* Ivan KPIs */}
      <div className="flex items-center gap-4 px-4 py-2 flex-shrink-0">
        <span
          className="font-mono-data text-xs uppercase tracking-widest"
          style={{ color: "#268bd2" }}
        >
          ivan
        </span>
        {ivanKpis.map((k) => (
          <div key={k.label} className="flex items-baseline gap-1">
            <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>
              {k.value}
            </span>
            <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
              {k.label.split(" ")[0].toLowerCase()}
            </span>
          </div>
        ))}
      </div>

      {/* Live indicator */}
      <div className="ml-auto flex items-center gap-2 px-4 flex-shrink-0">
        <span
          className="live-dot w-2 h-2 rounded-full"
          style={{ backgroundColor: "#859900" }}
        />
        <span className="font-mono-data text-xs" style={{ color: "#859900" }}>
          LIVE
        </span>
      </div>
    </div>
  );
}

function ConsoleNavBar() {
  return (
    <div
      className="flex items-center gap-6 px-4 py-2 border-b"
      style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}
    >
      <span className="font-mono-data text-xs" style={{ color: "#2aa198" }}>
        $ ari-ivan-dashboard
      </span>
      <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
        /
      </span>
      {["ari", "collaboration", "ivan"].map((tab) => (
        <span
          key={tab}
          className="font-mono-data text-xs cursor-pointer"
          style={{
            color: tab === "collaboration" ? "#eee8d5" : "#586e75",
            borderBottom:
              tab === "collaboration" ? "1px solid #2aa198" : "1px solid transparent",
          }}
        >
          {tab === "collaboration" ? "[collaboration]" : tab}
        </span>
      ))}
      <span className="font-mono-data text-xs ml-auto" style={{ color: "#586e75" }}>
        scisummary.com · public view
      </span>
    </div>
  );
}

function AriPanel() {
  const ariEvents = liveEvents.filter((e) => e.actor === "ari");
  return (
    <div
      className="flex flex-col h-full border-r"
      style={{ borderColor: "#586e75", backgroundColor: "#002b36" }}
    >
      <div
        className="px-3 py-2 border-b font-mono-data text-xs"
        style={{ borderColor: "#586e75", color: "#2aa198" }}
      >
        ┌─ ARI:OPERATOR ─────────────────
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll">
        {ariEvents.map((event) => (
          <div
            key={event.id}
            className="px-3 py-2 border-b font-mono-data text-xs"
            style={{ borderColor: "#073642" }}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span style={{ color: "#2aa198" }}>▸</span>
              <span style={{ color: "#586e75" }}>{event.time}</span>
              <span
                className="uppercase"
                style={{ color: "#b58900" }}
              >
                [{event.type}]
              </span>
            </div>
            <div style={{ color: "#839496" }} className="pl-4 leading-relaxed">
              {event.text}
            </div>
          </div>
        ))}
        {/* Metrics */}
        <div className="px-3 py-3 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-2" style={{ color: "#2aa198" }}>── KPIs (7d) ──</div>
          {ariKpis.map((k) => (
            <div key={k.label} className="flex justify-between mb-1">
              <span>{k.label}</span>
              <span style={{ color: "#eee8d5" }}>
                {k.value}{" "}
                {k.delta && (
                  <span style={{ color: "#859900" }}>{k.delta}</span>
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
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "#073642" }}
    >
      <div
        className="px-3 py-2 border-b font-mono-data text-xs"
        style={{ borderColor: "#586e75", color: "#93a1a1" }}
      >
        ┌─ STORIES:PIPELINE ─────────────
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll">
        {stories.map((story) => {
          const completedStages = story.stages.filter((s) => s.completedAt);
          return (
            <div
              key={story.id}
              className="px-3 py-2.5 border-b font-mono-data"
              style={{ borderColor: "#586e75" }}
            >
              {/* Title + status */}
              <div className="flex items-start gap-2 mb-1.5">
                <span style={{ color: STAGE_COLORS[story.status] || "#93a1a1" }}>
                  {story.status === "released" ? "✓" : "▶"}
                </span>
                <span className="text-xs" style={{ color: "#eee8d5" }}>
                  {story.title}
                </span>
              </div>
              {/* Stage progress */}
              <div className="flex items-center gap-1 pl-4">
                {story.stages.map((stage) => {
                  const done = !!stage.completedAt;
                  return (
                    <span
                      key={stage.type}
                      className="text-xs"
                      style={{
                        color: done
                          ? STAGE_COLORS[stage.type]
                          : "#586e75",
                      }}
                      title={stage.label}
                    >
                      {STAGE_LABELS[stage.type]}
                    </span>
                  );
                }).reduce((acc: React.ReactNode[], el, i) => {
                  if (i > 0)
                    acc.push(
                      <span key={`sep-${i}`} style={{ color: "#586e75" }}>
                        →
                      </span>
                    );
                  acc.push(el);
                  return acc;
                }, [])}
              </div>
              <div className="pl-4 mt-1 text-xs" style={{ color: "#586e75" }}>
                {story.primaryBusinessArea} · conf{" "}
                <span style={{ color: "#93a1a1" }}>
                  {Math.round(story.confidenceScore * 100)}%
                </span>{" "}
                · {story.startedAt}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IvanPanel() {
  const ivanEvents = liveEvents.filter((e) => e.actor === "ivan");
  return (
    <div
      className="flex flex-col h-full border-l"
      style={{ borderColor: "#586e75", backgroundColor: "#002b36" }}
    >
      <div
        className="px-3 py-2 border-b font-mono-data text-xs"
        style={{ borderColor: "#586e75", color: "#268bd2" }}
      >
        ┌─ IVAN:ENGINEER ─────────────────
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll">
        {ivanEvents.map((event) => (
          <div
            key={event.id}
            className="px-3 py-2 border-b font-mono-data text-xs"
            style={{ borderColor: "#073642" }}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span style={{ color: "#268bd2" }}>▸</span>
              <span style={{ color: "#586e75" }}>{event.time}</span>
              <span
                className="uppercase"
                style={{ color: "#6c71c4" }}
              >
                [{event.type}]
              </span>
            </div>
            <div style={{ color: "#839496" }} className="pl-4 leading-relaxed">
              {event.text}
            </div>
          </div>
        ))}
        {/* Metrics */}
        <div className="px-3 py-3 font-mono-data text-xs" style={{ color: "#586e75" }}>
          <div className="mb-2" style={{ color: "#268bd2" }}>── KPIs (7d) ──</div>
          {ivanKpis.map((k) => (
            <div key={k.label} className="flex justify-between mb-1">
              <span>{k.label}</span>
              <span style={{ color: "#eee8d5" }}>
                {k.value}{" "}
                {k.delta && (
                  <span style={{ color: "#859900" }}>{k.delta}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VariantC() {
  return (
    <div
      className="flex flex-col min-h-screen font-mono-data"
      style={{ backgroundColor: "#002b36", color: "#839496" }}
    >
      <ConsoleNavBar />
      <ConsoleKpiBar />

      {/* ── 3-panel layout ── */}
      <div className="flex flex-1 min-h-0" style={{ height: "calc(100vh - 80px)" }}>
        <div className="w-80 flex-shrink-0 overflow-hidden">
          <AriPanel />
        </div>
        <div className="flex-1 overflow-hidden">
          <StoryConsoleList />
        </div>
        <div className="w-80 flex-shrink-0 overflow-hidden">
          <IvanPanel />
        </div>
      </div>
    </div>
  );
}
