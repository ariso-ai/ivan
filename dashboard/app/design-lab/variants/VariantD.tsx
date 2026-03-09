"use client";
/**
 * Variant D — "Split Signal" — all 3 tabs interactive
 * Ari tab: full light (Solarized Light)
 * Ivan tab: full dark (Solarized Dark)
 * Collab: literal split with gradient bridge
 */
import { useState } from "react";
import { stories, ariKpis, ivanKpis, liveEvents, summaryStats } from "./fixtures";

type Tab = "ari" | "collab" | "ivan";

const STATUS_COLOR: Record<string, string> = {
  signal: "#b58900", insight: "#2aa198", engineering_task: "#268bd2",
  pr_opened: "#6c71c4", pr_merged: "#859900", released: "#859900",
};
const STATUS_LABEL: Record<string, string> = {
  signal: "Signal", insight: "Insight", engineering_task: "Building",
  pr_opened: "In Review", pr_merged: "Merged", released: "Shipped ✓",
};

// ── Ari full-page wallboard (Solarized Light) ─────────────────────────────────
function AriFullView() {
  const ariEvents = liveEvents.filter((e) => e.actor === "ari");
  return (
    <div className="flex flex-col" style={{ backgroundColor: "#fdf6e3", color: "#657b83", minHeight: 860 }}>
      {/* Header */}
      <div className="px-8 py-6 border-b" style={{ borderColor: "#eee8d5" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-bold mb-1" style={{ color: "#073642" }}>Ari</div>
            <div className="text-sm" style={{ color: "#93a1a1" }}>Operator · demand intelligence · SciSummary</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="live-dot w-2 h-2 rounded-full" style={{ backgroundColor: "#859900" }} />
            <span className="text-xs" style={{ color: "#859900" }}>live</span>
          </div>
        </div>
      </div>
      {/* Hero stats */}
      <div className="px-8 py-6 border-b" style={{ borderColor: "#eee8d5" }}>
        <div className="flex items-baseline gap-10">
          {ariKpis.map((kpi) => (
            <div key={kpi.label}>
              <div className="font-mono-data text-4xl font-semibold" style={{ color: "#073642" }}>
                {kpi.value}
                {kpi.delta && <span className="ml-2 text-lg" style={{ color: "#859900" }}>{kpi.delta}</span>}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#93a1a1" }}>{kpi.label} <span className="font-mono-data">{kpi.window}</span></div>
            </div>
          ))}
        </div>
      </div>
      {/* Activity */}
      <div className="flex flex-1">
        <div className="flex-1 px-8 py-6 overflow-y-auto light-scroll">
          <div className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#93a1a1" }}>Recent Ari activity</div>
          {ariEvents.map((event) => (
            <div key={event.id} className="mb-4 pb-4 border-b" style={{ borderColor: "#eee8d5" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs rounded px-1.5 py-0.5" style={{ backgroundColor: "#eee8d5", color: "#2aa198", fontFamily: "monospace" }}>
                  {event.type.replace(/_/g, " ")}
                </span>
                <span className="text-xs" style={{ color: "#93a1a1" }}>{event.time}</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "#657b83" }}>{event.text}</p>
            </div>
          ))}
        </div>
        {/* KPI detail sidebar */}
        <div className="w-72 border-l px-6 py-6" style={{ borderColor: "#eee8d5", backgroundColor: "#fdf6e3" }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#93a1a1" }}>Ari · KPI detail</div>
          {ariKpis.map((kpi) => (
            <div key={kpi.label} className="rounded-lg p-4 mb-3" style={{ backgroundColor: "#eee8d5" }}>
              <div className="font-mono-data text-2xl font-semibold" style={{ color: "#073642" }}>{kpi.value}</div>
              <div className="text-xs mt-0.5 flex items-center justify-between">
                <span style={{ color: "#93a1a1" }}>{kpi.label}</span>
                {kpi.delta && <span style={{ color: "#859900" }}>{kpi.delta}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Ivan full-page wallboard (Solarized Dark) ─────────────────────────────────
function IvanFullView() {
  const ivanEvents = liveEvents.filter((e) => e.actor === "ivan");
  return (
    <div className="flex flex-col" style={{ backgroundColor: "#002b36", color: "#839496", minHeight: 860 }}>
      {/* Header */}
      <div className="px-8 py-6 border-b" style={{ borderColor: "#073642" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono-data text-3xl font-semibold mb-1" style={{ color: "#eee8d5" }}>Ivan</div>
            <div className="font-mono-data text-xs" style={{ color: "#586e75" }}>engineer · execution layer · SciSummary</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="live-dot w-2 h-2 rounded-full" style={{ backgroundColor: "#859900" }} />
            <span className="font-mono-data text-xs" style={{ color: "#859900" }}>LIVE</span>
          </div>
        </div>
      </div>
      {/* Hero stats */}
      <div className="px-8 py-6 border-b" style={{ borderColor: "#073642" }}>
        <div className="flex items-baseline gap-10">
          {ivanKpis.map((kpi) => (
            <div key={kpi.label}>
              <div className="font-mono-data text-4xl font-semibold" style={{ color: "#eee8d5" }}>
                {kpi.value}
                {kpi.delta && <span className="ml-2 text-lg" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
              </div>
              <div className="font-mono-data text-xs mt-0.5" style={{ color: "#586e75" }}>{kpi.label} {kpi.window}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Activity */}
      <div className="flex flex-1">
        <div className="flex-1 px-8 py-6 overflow-y-auto dark-scroll">
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>Recent Ivan activity</div>
          {ivanEvents.map((event) => (
            <div key={event.id} className="mb-4 pb-4 border-b" style={{ borderColor: "#073642" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono-data text-xs rounded px-1.5 py-0.5 border" style={{ borderColor: "#268bd2", color: "#268bd2", backgroundColor: "#268bd210" }}>
                  {event.type.replace(/_/g, " ")}
                </span>
                <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{event.time}</span>
              </div>
              <p className="font-mono-data text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
            </div>
          ))}
        </div>
        {/* KPI detail sidebar */}
        <div className="w-72 border-l px-6 py-6" style={{ borderColor: "#073642" }}>
          <div className="font-mono-data text-xs uppercase tracking-widest mb-4" style={{ color: "#586e75" }}>Ivan · KPI detail</div>
          {ivanKpis.map((kpi) => (
            <div key={kpi.label} className="rounded-lg p-4 mb-3 border" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
              <div className="font-mono-data text-2xl font-semibold" style={{ color: "#eee8d5" }}>{kpi.value}</div>
              <div className="font-mono-data text-xs mt-0.5 flex items-center justify-between">
                <span style={{ color: "#586e75" }}>{kpi.label}</span>
                {kpi.delta && <span style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Ari left panel (inside collab split) ─────────────────────────────────────
function AriSide() {
  return (
    <div className="flex flex-col border-r-4" style={{ height: 860, backgroundColor: "#fdf6e3", borderColor: "#eee8d5", color: "#657b83" }}>
      <div className="px-6 py-5 border-b" style={{ borderColor: "#eee8d5" }}>
        <div className="text-2xl font-bold mb-0.5" style={{ color: "#073642" }}>Ari</div>
        <div className="text-sm" style={{ color: "#93a1a1" }}>Operator · demand intelligence</div>
      </div>
      <div className="px-6 py-4 border-b" style={{ borderColor: "#eee8d5" }}>
        <div className="grid grid-cols-2 gap-3">
          {ariKpis.map((kpi) => (
            <div key={kpi.label} className="rounded-lg p-3" style={{ backgroundColor: "#eee8d5" }}>
              <div className="font-mono-data text-xl font-semibold" style={{ color: "#073642" }}>
                {kpi.value}
                {kpi.delta && <span className="ml-1.5 text-xs" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#93a1a1" }}>{kpi.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto light-scroll px-6 py-3">
        <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#93a1a1" }}>Recent activity</div>
        {liveEvents.filter((e) => e.actor === "ari").map((event) => (
          <div key={event.id} className="mb-3 pb-3 border-b" style={{ borderColor: "#eee8d5" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs rounded px-1.5 py-0.5" style={{ backgroundColor: "#eee8d5", color: "#2aa198", fontFamily: "monospace" }}>{event.type.replace(/_/g, "·")}</span>
              <span className="text-xs" style={{ color: "#93a1a1" }}>{event.time}</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#657b83" }}>{event.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function IvanSide() {
  return (
    <div className="flex flex-col border-l-4" style={{ height: 860, backgroundColor: "#002b36", borderColor: "#073642", color: "#839496" }}>
      <div className="px-6 py-5 border-b" style={{ borderColor: "#073642" }}>
        <div className="font-mono-data text-2xl font-semibold mb-0.5" style={{ color: "#eee8d5" }}>Ivan</div>
        <div className="font-mono-data text-xs" style={{ color: "#586e75" }}>engineer · execution layer</div>
      </div>
      <div className="px-6 py-4 border-b" style={{ borderColor: "#073642" }}>
        <div className="grid grid-cols-2 gap-3">
          {ivanKpis.map((kpi) => (
            <div key={kpi.label} className="rounded-lg p-3 border" style={{ backgroundColor: "#073642", borderColor: "#586e75" }}>
              <div className="font-mono-data text-xl font-semibold" style={{ color: "#eee8d5" }}>
                {kpi.value}
                {kpi.delta && <span className="ml-1.5 text-xs" style={{ color: kpi.deltaDir === "up" ? "#859900" : "#dc322f" }}>{kpi.delta}</span>}
              </div>
              <div className="font-mono-data text-xs mt-0.5" style={{ color: "#586e75" }}>{kpi.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dark-scroll px-6 py-3">
        <div className="font-mono-data text-xs uppercase tracking-widest mb-3" style={{ color: "#586e75" }}>Recent activity</div>
        {liveEvents.filter((e) => e.actor === "ivan").map((event) => (
          <div key={event.id} className="mb-3 pb-3 border-b" style={{ borderColor: "#073642" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono-data text-xs rounded px-1.5 py-0.5 border" style={{ borderColor: "#268bd2", color: "#268bd2", backgroundColor: "#268bd210" }}>{event.type.replace(/_/g, "·")}</span>
              <span className="font-mono-data text-xs" style={{ color: "#586e75" }}>{event.time}</span>
            </div>
            <p className="font-mono-data text-xs leading-relaxed" style={{ color: "#839496" }}>{event.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StoriesBridge({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "ari", label: "Ari" },
    { id: "collab", label: "Ari ↔ Ivan" },
    { id: "ivan", label: "Ivan" },
  ];
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 860, background: "linear-gradient(180deg, #eee8d5 0%, #073642 100%)" }}>
      <div className="px-4 py-5 text-center">
        <div className="font-mono-data text-4xl font-bold" style={{ color: "#002b36" }}>{summaryStats.storiesThisWeek}</div>
        <div className="text-xs font-medium mt-0.5" style={{ color: "#657b83" }}>stories this week</div>
        <div className="mt-2 flex items-center justify-center gap-1">
          <span className="live-dot w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#859900" }} />
          <span className="text-xs" style={{ color: "#859900" }}>{summaryStats.loopClosedPct}% loop closed</span>
        </div>
      </div>
      {/* Tab nav in bridge */}
      <div className="flex justify-around py-2 border-y" style={{ borderColor: "#93a1a1" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="text-xs font-medium"
            style={{
              color: tab === t.id ? "#002b36" : "#93a1a1",
              textDecoration: tab === t.id ? "underline" : "none",
              background: "none", border: "none", cursor: "pointer",
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {stories.map((story) => {
          const pct = (story.stages.filter((s) => s.completedAt).length / story.stages.length) * 100;
          const color = STATUS_COLOR[story.status] || "#93a1a1";
          return (
            <div key={story.id} className="mb-2 rounded-lg p-3 border" style={{ backgroundColor: "rgba(0,0,0,0.15)", borderColor: `${color}44` }}>
              <div className="text-xs font-semibold mb-1 leading-tight" style={{ color: "#eee8d5" }}>{story.title}</div>
              <div className="h-1 rounded-full mb-1 overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
              <div className="flex justify-between">
                <span className="font-mono-data text-xs" style={{ color }}>{STATUS_LABEL[story.status]}</span>
                <span className="text-xs" style={{ color: "#93a1a1" }}>{story.primaryBusinessArea}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VariantD() {
  const [tab, setTab] = useState<Tab>("collab");

  if (tab === "ari") return <AriFullView />;
  if (tab === "ivan") return <IvanFullView />;

  // Collab = split view
  return (
    <div className="flex" style={{ height: 860 }}>
      <div className="w-72 flex-shrink-0 overflow-hidden"><AriSide /></div>
      <div className="flex-1 overflow-hidden"><StoriesBridge tab={tab} setTab={setTab} /></div>
      <div className="w-72 flex-shrink-0 overflow-hidden"><IvanSide /></div>
    </div>
  );
}
