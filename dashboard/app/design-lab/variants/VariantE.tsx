"use client";
/**
 * Variant E — "Wallboard" — all 3 tabs interactive
 * Layout: Full-bleed top hero number | wide pipeline stages | bottom grid (3 columns)
 * Style: Solarized Dark dominant, strong accent color use for visual scan
 * Typography: Giant display numbers, clean condensed labels
 * Density: Information-dense + viral-ready hero numbers designed for screenshots
 */
import { useState } from "react";
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

type Tab = "ari" | "collab" | "ivan";

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

function NavBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "ari", label: "Ari" },
    { id: "collab", label: "Ari ↔ Ivan" },
    { id: "ivan", label: "Ivan" },
  ];
  return (
    <div className="flex items-center justify-between px-8 py-3 border-b" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
      <nav className="flex items-center gap-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="text-sm font-medium"
            style={{
              color: tab === t.id ? "#eee8d5" : "#586e75",
              borderBottom: `2px solid ${tab === t.id ? "#268bd2" : "transparent"}`,
              paddingBottom: 2,
              background: "none",
              border: "none",
              borderBottomWidth: 2,
              borderBottomStyle: "solid",
              borderBottomColor: tab === t.id ? "#268bd2" : "transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <span className="live-dot w-2 h-2 rounded-full" style={{ backgroundColor: "#859900" }} />
        <span className="font-mono-data text-xs" style={{ color: "#859900" }}>LIVE · SciSummary</span>
      </div>
    </div>
  );
}

// ── Ari Wallboard ─────────────────────────────────────────────────────────────
function AriWallboard() {
  const ariEvents = liveEvents.filter((e) => e.actor === "ari");
  return (
    <>
      {/* Giant hero numbers */}
      <div className="relative overflow-hidden" style={{ backgroundColor: "#073642" }}>
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #839496 0, #839496 1px, transparent 0, transparent 50%),repeating-linear-gradient(90deg, #839496 0, #839496 1px, transparent 0, transparent 50%)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative z-10 px-8 py-8">
          <div className="mb-4">
            <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#2aa198" }}>
              ari · operator layer · scisummary
            </span>
          </div>
          <div className="flex items-end gap-12 flex-wrap">
            <div>
              <div className="font-mono-data leading-none" style={{ fontSize: 96, fontWeight: 700, color: "#2aa198" }}>
                {ariKpis[0].value}
              </div>
              <div className="text-lg font-medium mt-1" style={{ color: "#586e75" }}>signals captured · 7d</div>
            </div>
            <div className="mb-4">
              <div className="font-mono-data leading-none" style={{ fontSize: 64, fontWeight: 600, color: "#b58900" }}>
                {ariKpis[1].value}
              </div>
              <div className="text-sm" style={{ color: "#586e75" }}>insights generated</div>
            </div>
            <div className="mb-4">
              <div className="font-mono-data leading-none" style={{ fontSize: 64, fontWeight: 600, color: "#859900" }}>
                {ariKpis[3]?.value ?? "—"}
              </div>
              <div className="text-sm" style={{ color: "#586e75" }}>conversion signals</div>
            </div>
            <div className="mb-4 ml-auto text-right">
              <p className="text-sm max-w-xs leading-relaxed" style={{ color: "#839496" }}>
                <span style={{ color: "#2aa198" }}>Ari</span> reads the market.<br />
                Every signal turned into shipped product.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI grid + live feed */}
      <div className="flex flex-1" style={{ minHeight: 0, height: 520 }}>
        <div className="flex-1 p-6 overflow-y-auto dark-scroll">
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>
            Ari · all metrics
          </div>
          <div className="grid grid-cols-2 gap-4">
            {ariKpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border p-4" style={{ backgroundColor: "#073642", borderColor: "#2aa198", borderTopWidth: 2 }}>
                <div className="font-mono-data text-3xl font-semibold mb-1" style={{ color: "#2aa198" }}>
                  {kpi.value}
                  {kpi.delta && (
                    <span className="ml-2 text-base" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>
                  )}
                </div>
                <div className="text-xs" style={{ color: "#839496" }}>
                  {kpi.label} <span className="font-mono-data" style={{ color: "#586e75" }}>{kpi.window}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ari activity feed */}
        <div className="w-80 border-l flex flex-col flex-shrink-0" style={{ borderColor: "#586e75" }}>
          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#2aa198" }}>Ari · live activity</span>
          </div>
          <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0, backgroundColor: "#002b36" }}>
            {ariEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 border-b" style={{ borderColor: "#073642" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono-data text-xs font-semibold" style={{ color: "#2aa198" }}>ARI</span>
                  <span className="text-xs" style={{ color: "#586e75" }}>{event.time}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Ivan Wallboard ────────────────────────────────────────────────────────────
function IvanWallboard() {
  const ivanEvents = liveEvents.filter((e) => e.actor === "ivan");
  return (
    <>
      {/* Giant hero numbers */}
      <div className="relative overflow-hidden" style={{ backgroundColor: "#002b36" }}>
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #839496 0, #839496 1px, transparent 0, transparent 50%),repeating-linear-gradient(90deg, #839496 0, #839496 1px, transparent 0, transparent 50%)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative z-10 px-8 py-8">
          <div className="mb-4">
            <span className="font-mono-data text-xs uppercase tracking-widest" style={{ color: "#268bd2" }}>
              ivan · engineering layer · scisummary
            </span>
          </div>
          <div className="flex items-end gap-12 flex-wrap">
            <div>
              <div className="font-mono-data leading-none" style={{ fontSize: 96, fontWeight: 700, color: "#268bd2" }}>
                {ivanKpis[0].value}
              </div>
              <div className="text-lg font-medium mt-1" style={{ color: "#586e75" }}>PRs merged · 7d</div>
            </div>
            <div className="mb-4">
              <div className="font-mono-data leading-none" style={{ fontSize: 64, fontWeight: 600, color: "#2aa198" }}>
                {ivanKpis[1].value}
              </div>
              <div className="text-sm" style={{ color: "#586e75" }}>avg signal → PR</div>
            </div>
            <div className="mb-4">
              <div className="font-mono-data leading-none" style={{ fontSize: 64, fontWeight: 600, color: "#859900" }}>
                {ivanKpis[2].value}
              </div>
              <div className="text-sm" style={{ color: "#586e75" }}>tasks completed</div>
            </div>
            <div className="mb-4 ml-auto text-right">
              <p className="text-sm max-w-xs leading-relaxed" style={{ color: "#839496" }}>
                <span style={{ color: "#268bd2" }}>Ivan</span> engineers the response.<br />
                Signal in. Shipped code out.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI grid + live feed */}
      <div className="flex flex-1" style={{ minHeight: 0, height: 520 }}>
        <div className="flex-1 p-6 overflow-y-auto dark-scroll">
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>
            Ivan · all metrics
          </div>
          <div className="grid grid-cols-2 gap-4">
            {ivanKpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border p-4" style={{ backgroundColor: "#073642", borderColor: "#268bd2", borderTopWidth: 2 }}>
                <div className="font-mono-data text-3xl font-semibold mb-1" style={{ color: "#268bd2" }}>
                  {kpi.value}
                  {kpi.delta && (
                    <span className="ml-2 text-base" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>
                  )}
                </div>
                <div className="text-xs" style={{ color: "#839496" }}>
                  {kpi.label} <span className="font-mono-data" style={{ color: "#586e75" }}>{kpi.window}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ivan activity feed */}
        <div className="w-80 border-l flex flex-col flex-shrink-0" style={{ borderColor: "#586e75" }}>
          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#268bd2" }}>Ivan · live activity</span>
          </div>
          <div className="flex-1 overflow-y-auto dark-scroll" style={{ minHeight: 0, backgroundColor: "#002b36" }}>
            {ivanEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 border-b" style={{ borderColor: "#073642" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono-data text-xs font-semibold" style={{ color: "#268bd2" }}>IVAN</span>
                  <span className="text-xs" style={{ color: "#586e75" }}>{event.time}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Collab Wallboard (original layout) ────────────────────────────────────────
function CollabWallboard() {
  const activeStages = stories.reduce((acc, story) => {
    story.stages.forEach((s) => { if (s.completedAt) acc.add(s.type); });
    return acc;
  }, new Set<string>());

  const stages = [
    { key: "signal", label: "Customer Signal", actor: "Ari" },
    { key: "insight", label: "Ari Insight", actor: "Ari" },
    { key: "engineering_task", label: "Engineering Task", actor: "Ivan" },
    { key: "pr_opened", label: "Pull Request", actor: "Ivan" },
    { key: "pr_merged", label: "PR Merged", actor: "Ivan" },
    { key: "released", label: "Live Release", actor: "System" },
  ];

  return (
    <>
      {/* Giant hero numbers */}
      <div className="relative overflow-hidden" style={{ backgroundColor: "#073642" }}>
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #839496 0, #839496 1px, transparent 0, transparent 50%),repeating-linear-gradient(90deg, #839496 0, #839496 1px, transparent 0, transparent 50%)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative z-10 px-8 py-6">
          <div className="flex items-end gap-12 flex-wrap">
            <div>
              <div className="font-mono-data leading-none" style={{ fontSize: 96, fontWeight: 700, color: "#eee8d5" }}>
                {summaryStats.storiesThisWeek}
              </div>
              <div className="text-lg font-medium mt-1" style={{ color: "#586e75" }}>stories closed this week</div>
            </div>
            <div className="mb-4">
              <div className="font-mono-data leading-none" style={{ fontSize: 64, fontWeight: 600, color: "#859900" }}>
                {summaryStats.loopClosedPct}%
              </div>
              <div className="text-sm" style={{ color: "#586e75" }}>loop closed</div>
            </div>
            <div className="mb-4">
              <div className="font-mono-data leading-none" style={{ fontSize: 64, fontWeight: 600, color: "#2aa198" }}>
                {summaryStats.avgSignalToPr}
              </div>
              <div className="text-sm" style={{ color: "#586e75" }}>signal → PR</div>
            </div>
            <div className="mb-4 ml-auto text-right">
              <p className="text-sm max-w-xs leading-relaxed" style={{ color: "#839496" }}>
                <span style={{ color: "#2aa198" }}>Ari</span> captures customer demand.{" "}
                <span style={{ color: "#268bd2" }}>Ivan</span> engineers the response.<br />
                Every metric is live, every story is real.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Wide pipeline timeline */}
      <div className="border-y" style={{ backgroundColor: "#002b36", borderColor: "#586e75" }}>
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
                          width: 36, height: 36,
                          backgroundColor: active ? `${color}22` : "#073642",
                          border: `2px solid ${active ? color : "#586e75"}`,
                          color: active ? color : "#586e75",
                        }}
                      >
                        {STAGE_ICONS[stage.key]}
                      </div>
                      <div>
                        <div className="text-xs font-medium" style={{ color: active ? "#eee8d5" : "#586e75" }}>{stage.label}</div>
                        <div className="font-mono-data text-xs" style={{ color: stage.actor === "Ari" ? "#2aa198" : stage.actor === "Ivan" ? "#268bd2" : "#586e75" }}>
                          {stage.actor}
                        </div>
                      </div>
                    </div>
                  </div>
                  {i < stages.length - 1 && <div className="flex-1 mx-3 h-px" style={{ backgroundColor: "#586e75" }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stories grid */}
      <div className="p-6">
        <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>Recent Stories</div>
        <div className="grid grid-cols-5 gap-3">
          {stories.map((story) => {
            const color = STAGE_COLORS[story.status] || "#93a1a1";
            const pct = (story.stages.filter((s) => s.completedAt).length / story.stages.length) * 100;
            return (
              <div key={story.id} className="rounded-lg p-3 border" style={{ backgroundColor: "#073642", borderColor: "#586e75", borderTopColor: color, borderTopWidth: 2 }}>
                <div className="text-xs font-medium mb-2 leading-snug" style={{ color: "#eee8d5" }}>{story.title}</div>
                <div className="h-0.5 rounded-full mb-2 overflow-hidden" style={{ backgroundColor: "#002b36" }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono-data text-xs" style={{ color }}>
                    {story.status === "released" ? "✓ Shipped" : story.status.replace("_", " ")}
                  </span>
                  <span className="text-xs" style={{ color: "#586e75" }}>{story.startedAt}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-3 gap-4 px-6 pb-6">
        {/* Ari KPI panel */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#586e75" }}>
          <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#2aa198" }} />
            <span className="text-xs font-semibold" style={{ color: "#2aa198" }}>Ari · Operator</span>
          </div>
          <div style={{ backgroundColor: "#002b36" }}>
            {ariKpis.map((kpi) => (
              <div key={kpi.label} className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "#073642" }}>
                <span className="text-xs" style={{ color: "#839496" }}>{kpi.label}</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>{kpi.value}</span>
                  {kpi.delta && <span className="font-mono-data text-xs" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live feed panel */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#586e75" }}>
          <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
            <div className="flex items-center gap-2">
              <span className="live-dot w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#859900" }} />
              <span className="text-xs font-semibold" style={{ color: "#859900" }}>Live Handoff Feed</span>
            </div>
          </div>
          <div className="overflow-y-auto dark-scroll" style={{ backgroundColor: "#002b36", maxHeight: 260 }}>
            {liveEvents.map((event) => (
              <div key={event.id} className="px-4 py-2.5 border-b" style={{ borderColor: "#073642" }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono-data text-xs font-semibold" style={{ color: event.actor === "ari" ? "#2aa198" : "#268bd2" }}>
                    {event.actor.toUpperCase()}
                  </span>
                  <span className="text-xs" style={{ color: "#586e75" }}>{event.time}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Ivan KPI panel */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#586e75" }}>
          <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#268bd2" }} />
            <span className="text-xs font-semibold" style={{ color: "#268bd2" }}>Ivan · Engineer</span>
          </div>
          <div style={{ backgroundColor: "#002b36" }}>
            {ivanKpis.map((kpi) => (
              <div key={kpi.label} className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "#073642" }}>
                <span className="font-mono-data text-xs" style={{ color: "#839496" }}>{kpi.label}</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono-data text-sm font-semibold" style={{ color: "#eee8d5" }}>{kpi.value}</span>
                  {kpi.delta && <span className="font-mono-data text-xs" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function VariantE() {
  const [tab, setTab] = useState<Tab>("collab");

  return (
    <div className="flex flex-col font-sans" style={{ backgroundColor: "#002b36", color: "#839496", minHeight: 860 }}>
      <NavBar tab={tab} setTab={setTab} />
      {tab === "ari" && <AriWallboard />}
      {tab === "collab" && <CollabWallboard />}
      {tab === "ivan" && <IvanWallboard />}
    </div>
  );
}
