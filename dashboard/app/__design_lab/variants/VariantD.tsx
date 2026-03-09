"use client";
/**
 * Variant D — "Split Signal"
 * Layout: Hard vertical split — Ari light left | stories center | Ivan dark right
 * Style: Literal Solarized split — #fdf6e3 on left, #002b36 on right, bridging center
 * Typography: Editorial sans on Ari side, mono on Ivan side, display for numbers
 * Density: Medium — strong visual metaphor over maximum data
 */
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

const STATUS_COLOR: Record<string, string> = {
  signal:           "#b58900",
  insight:          "#2aa198",
  engineering_task: "#268bd2",
  pr_opened:        "#6c71c4",
  pr_merged:        "#859900",
  released:         "#859900",
};

const STATUS_LABEL: Record<string, string> = {
  signal:           "Signal",
  insight:          "Insight",
  engineering_task: "Building",
  pr_opened:        "In Review",
  pr_merged:        "Merged",
  released:         "Shipped ✓",
};

function AriSide() {
  return (
    <div
      className="flex flex-col h-full border-r-4"
      style={{
        backgroundColor: "#fdf6e3",
        borderColor: "#eee8d5",
        color: "#657b83",
      }}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b" style={{ borderColor: "#eee8d5" }}>
        <div
          className="text-2xl font-bold mb-0.5"
          style={{ color: "#073642" }}
        >
          Ari
        </div>
        <div className="text-sm" style={{ color: "#93a1a1" }}>
          Operator · demand intelligence
        </div>
      </div>

      {/* KPIs */}
      <div className="px-6 py-4 border-b" style={{ borderColor: "#eee8d5" }}>
        <div className="grid grid-cols-2 gap-3">
          {ariKpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-lg p-3"
              style={{ backgroundColor: "#eee8d5" }}
            >
              <div
                className="font-mono-data text-xl font-semibold"
                style={{ color: "#073642" }}
              >
                {kpi.value}
                {kpi.delta && (
                  <span
                    className="ml-1.5 text-xs"
                    style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}
                  >
                    {kpi.delta}
                  </span>
                )}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#93a1a1" }}>
                {kpi.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ari events */}
      <div className="flex-1 overflow-y-auto light-scroll px-6 py-3">
        <div
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: "#93a1a1" }}
        >
          Recent activity
        </div>
        {liveEvents
          .filter((e) => e.actor === "ari")
          .map((event) => (
            <div
              key={event.id}
              className="mb-3 pb-3 border-b"
              style={{ borderColor: "#eee8d5" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs rounded px-1.5 py-0.5"
                  style={{
                    backgroundColor: "#eee8d5",
                    color: "#2aa198",
                    fontFamily: "monospace",
                  }}
                >
                  {event.type.replace("_", "·")}
                </span>
                <span className="text-xs" style={{ color: "#93a1a1" }}>
                  {event.time}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#657b83" }}>
                {event.text}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}

function IvanSide() {
  return (
    <div
      className="flex flex-col h-full border-l-4"
      style={{
        backgroundColor: "#002b36",
        borderColor: "#073642",
        color: "#839496",
      }}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b" style={{ borderColor: "#073642" }}>
        <div
          className="font-mono-data text-2xl font-semibold mb-0.5"
          style={{ color: "#eee8d5" }}
        >
          Ivan
        </div>
        <div className="font-mono-data text-xs" style={{ color: "#586e75" }}>
          engineer · execution layer
        </div>
      </div>

      {/* KPIs */}
      <div className="px-6 py-4 border-b" style={{ borderColor: "#073642" }}>
        <div className="grid grid-cols-2 gap-3">
          {ivanKpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-lg p-3 border"
              style={{ backgroundColor: "#073642", borderColor: "#586e75" }}
            >
              <div
                className="font-mono-data text-xl font-semibold"
                style={{ color: "#eee8d5" }}
              >
                {kpi.value}
                {kpi.delta && (
                  <span
                    className="ml-1.5 text-xs"
                    style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}
                  >
                    {kpi.delta}
                  </span>
                )}
              </div>
              <div className="font-mono-data text-xs mt-0.5" style={{ color: "#586e75" }}>
                {kpi.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ivan events */}
      <div className="flex-1 overflow-y-auto dark-scroll px-6 py-3">
        <div
          className="font-mono-data text-xs uppercase tracking-widest mb-3"
          style={{ color: "#586e75" }}
        >
          Recent activity
        </div>
        {liveEvents
          .filter((e) => e.actor === "ivan")
          .map((event) => (
            <div
              key={event.id}
              className="mb-3 pb-3 border-b"
              style={{ borderColor: "#073642" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="font-mono-data text-xs rounded px-1.5 py-0.5 border"
                  style={{
                    borderColor: "#268bd2",
                    color: "#268bd2",
                    backgroundColor: "#268bd210",
                  }}
                >
                  {event.type.replace("_", "·")}
                </span>
                <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>
                  {event.time}
                </span>
              </div>
              <p
                className="font-mono-data text-xs leading-relaxed"
                style={{ color: "#839496" }}
              >
                {event.text}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}

function StoriesBridge() {
  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #eee8d5 0%, #073642 100%)",
      }}
    >
      {/* Hero */}
      <div className="px-4 py-5 text-center">
        <div
          className="font-mono-data text-4xl font-bold"
          style={{ color: "#002b36" }}
        >
          {summaryStats.storiesThisWeek}
        </div>
        <div className="text-xs font-medium mt-0.5" style={{ color: "#657b83" }}>
          stories this week
        </div>
        <div className="mt-2 flex items-center justify-center gap-1">
          <span
            className="live-dot w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#859900" }}
          />
          <span className="text-xs" style={{ color: "#859900" }}>
            {summaryStats.loopClosedPct}% loop closed
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div
        className="flex justify-around py-2 border-y"
        style={{ borderColor: "#93a1a1" }}
      >
        {["Ari", "Ari ↔ Ivan", "Ivan"].map((tab) => (
          <button
            key={tab}
            className="text-xs font-medium"
            style={{
              color: tab === "Ari ↔ Ivan" ? "#002b36" : "#93a1a1",
              textDecoration: tab === "Ari ↔ Ivan" ? "underline" : "none",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Stories list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {stories.map((story) => {
          const pct =
            (story.stages.filter((s) => s.completedAt).length /
              story.stages.length) *
            100;
          const color = STATUS_COLOR[story.status] || "#93a1a1";

          return (
            <div
              key={story.id}
              className="mb-2 rounded-lg p-3 border"
              style={{
                backgroundColor: "rgba(0,0,0,0.15)",
                borderColor: `${color}44`,
              }}
            >
              <div
                className="text-xs font-semibold mb-1 leading-tight"
                style={{ color: "#eee8d5" }}
              >
                {story.title}
              </div>
              <div
                className="h-1 rounded-full mb-1 overflow-hidden"
                style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <div className="flex justify-between">
                <span className="font-mono-data text-xs" style={{ color }}>
                  {STATUS_LABEL[story.status]}
                </span>
                <span className="text-xs" style={{ color: "#93a1a1" }}>
                  {story.primaryBusinessArea}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VariantD() {
  return (
    <div className="flex min-h-screen" style={{ height: "100vh" }}>
      {/* Ari - light side */}
      <div className="w-72 flex-shrink-0 overflow-hidden">
        <AriSide />
      </div>

      {/* Bridge - stories */}
      <div className="flex-1 overflow-hidden">
        <StoriesBridge />
      </div>

      {/* Ivan - dark side */}
      <div className="w-72 flex-shrink-0 overflow-hidden">
        <IvanSide />
      </div>
    </div>
  );
}
