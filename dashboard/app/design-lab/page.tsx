import { VariantA } from "./variants/VariantA";
import { VariantB } from "./variants/VariantB";
import { VariantC } from "./variants/VariantC";
import { VariantD } from "./variants/VariantD";
import { VariantE } from "./variants/VariantE";
import { FeedbackOverlay } from "./FeedbackOverlay";

const variants = [
  {
    id: "A",
    name: "Command Center",
    rationale:
      "Dense ops-room layout. KPI strips on top, story pipeline list + live feed in split pane. Dark throughout. Maximally dense — every row is data.",
    component: VariantA,
  },
  {
    id: "B",
    name: "Story Narrative",
    rationale:
      "Story-first hierarchy. Big hero statement → horizontal pipeline timeline → story cards grid. Balanced density. Good for external sharers who want to understand the loop quickly.",
    component: VariantB,
  },
  {
    id: "C",
    name: "Live Console",
    rationale:
      "Full monospace, 3-panel split: Ari feed | stories | Ivan feed. Terminal-grade density. Maximum ops credibility. Designed for wallboard display.",
    component: VariantC,
  },
  {
    id: "D",
    name: "Split Signal",
    rationale:
      "Hard visual split — Solarized Light (Ari) on left, Solarized Dark (Ivan) on right, stories bridging the center. Strong metaphor for the two-sided collaboration loop.",
    component: VariantD,
  },
  {
    id: "E",
    name: "Wallboard",
    rationale:
      "Viral-ready giant hero numbers. Built for screenshots and sharing. Wide pipeline timeline, story grid below, KPI panels at bottom. Most buzzworthy above the fold.",
    component: VariantE,
  },
];

export default function DesignLabPage() {
  return (
    <div
      style={{ backgroundColor: "#002b36", minHeight: "100vh" }}
      className="font-sans"
    >
      {/* ── Lab Header ── */}
      <div
        className="sticky top-0 z-40 border-b px-8 py-4"
        style={{ backgroundColor: "#073642", borderColor: "#586e75" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "#eee8d5" }}>
              Design Lab · Ari ↔ Ivan Dashboard
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "#586e75" }}>
              5 variants · Ari↔Ivan collaboration page (default view) · Solarized
              palette · dense wallboard
            </p>
          </div>
          <div
            className="text-xs rounded-lg px-3 py-2 border max-w-sm"
            style={{
              backgroundColor: "#002b36",
              borderColor: "#586e75",
              color: "#839496",
            }}
          >
            <strong style={{ color: "#eee8d5" }}>How to review:</strong> Scroll through
            each variant. Use the{" "}
            <strong style={{ color: "#268bd2" }}>💬 Add Feedback</strong> button
            (bottom-right) to click elements and leave comments. Fill in the overall
            direction, then copy and paste the feedback into the terminal.
          </div>
        </div>
      </div>

      {/* ── Variants ── */}
      <div className="space-y-0">
        {variants.map((variant) => {
          const Component = variant.component;
          return (
            <div key={variant.id} className="border-b" style={{ borderColor: "#586e75" }}>
              {/* Variant label */}
              <div
                className="flex items-center gap-4 px-8 py-3 border-b"
                style={{
                  backgroundColor: "#073642",
                  borderColor: "#586e75",
                }}
              >
                <span
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: "#268bd2", color: "#fdf6e3" }}
                >
                  {variant.id}
                </span>
                <div>
                  <span
                    className="font-semibold text-sm"
                    style={{ color: "#eee8d5" }}
                  >
                    {variant.name}
                  </span>
                  <span
                    className="ml-3 text-xs"
                    style={{ color: "#839496" }}
                  >
                    {variant.rationale}
                  </span>
                </div>
              </div>

              {/* Variant render */}
              <div
                data-variant={variant.id}
                style={{
                  minHeight: 600,
                  position: "relative",
                  overflow: "auto",
                }}
              >
                <Component />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Feedback Overlay ── */}
      <FeedbackOverlay targetName="AriIvanDashboard" />
    </div>
  );
}
