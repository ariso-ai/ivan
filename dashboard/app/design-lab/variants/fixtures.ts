export type StoryStatus =
  | "signal"
  | "insight"
  | "engineering_task"
  | "pr_opened"
  | "pr_merged"
  | "released";

export interface Story {
  id: string;
  title: string;
  publicSummary: string;
  status: StoryStatus;
  startedAt: string;
  updatedAt: string;
  primaryBusinessArea: string;
  confidenceScore: number;
  stages: {
    type: StoryStatus;
    label: string;
    completedAt?: string;
    actor: "ari" | "ivan" | "system";
  }[];
}

export interface KpiMetric {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: "up" | "down" | "neutral";
  window: string;
}

export interface LiveEvent {
  id: string;
  time: string;
  actor: "ari" | "ivan";
  type: string;
  text: string;
}

// ─── Stories ────────────────────────────────────────────────────────────────

export const stories: Story[] = [
  {
    id: "s1",
    title: "Churn Signal → Retention Feature",
    publicSummary:
      "Customer patterns indicated rising cancellation intent in the free tier. Ari surfaced the signal; Ivan shipped a usage-summary email feature.",
    status: "released",
    startedAt: "6 days ago",
    updatedAt: "1 day ago",
    primaryBusinessArea: "Retention",
    confidenceScore: 0.92,
    stages: [
      { type: "signal", label: "Churn signal detected", completedAt: "6d ago", actor: "ari" },
      { type: "insight", label: "Free-tier drop-off insight", completedAt: "5d ago", actor: "ari" },
      { type: "engineering_task", label: "Usage summary email task", completedAt: "4d ago", actor: "ivan" },
      { type: "pr_opened", label: "PR #214 opened", completedAt: "3d ago", actor: "ivan" },
      { type: "pr_merged", label: "PR #214 merged", completedAt: "2d ago", actor: "ivan" },
      { type: "released", label: "Release v1.8.4", completedAt: "1d ago", actor: "system" },
    ],
  },
  {
    id: "s2",
    title: "API Latency Complaint → Caching Layer",
    publicSummary:
      "Repeated user feedback about slow API responses. Ari identified the pattern; Ivan implemented a Redis-backed cache.",
    status: "pr_merged",
    startedAt: "4 days ago",
    updatedAt: "6 hours ago",
    primaryBusinessArea: "Performance",
    confidenceScore: 0.87,
    stages: [
      { type: "signal", label: "API latency complaints", completedAt: "4d ago", actor: "ari" },
      { type: "insight", label: "P95 latency > 3s pattern", completedAt: "3d ago", actor: "ari" },
      { type: "engineering_task", label: "Response caching task", completedAt: "3d ago", actor: "ivan" },
      { type: "pr_opened", label: "PR #218 opened", completedAt: "2d ago", actor: "ivan" },
      { type: "pr_merged", label: "PR #218 merged", completedAt: "6h ago", actor: "ivan" },
      { type: "released", label: "Pending release", actor: "system" },
    ],
  },
  {
    id: "s3",
    title: "Affiliate Confusion → Docs Overhaul",
    publicSummary:
      "Support signals showed confusion around the affiliate program. Ari flagged it; Ivan rewrote the affiliate onboarding flow.",
    status: "pr_opened",
    startedAt: "2 days ago",
    updatedAt: "3 hours ago",
    primaryBusinessArea: "Growth",
    confidenceScore: 0.78,
    stages: [
      { type: "signal", label: "Affiliate confusion signals", completedAt: "2d ago", actor: "ari" },
      { type: "insight", label: "Onboarding drop-off pattern", completedAt: "2d ago", actor: "ari" },
      { type: "engineering_task", label: "Docs rewrite task", completedAt: "1d ago", actor: "ivan" },
      { type: "pr_opened", label: "PR #221 opened", completedAt: "3h ago", actor: "ivan" },
      { type: "pr_merged", label: "In review", actor: "ivan" },
      { type: "released", label: "Pending", actor: "system" },
    ],
  },
  {
    id: "s4",
    title: "PDF Export Request → Feature Ship",
    publicSummary:
      "High-frequency feature request for PDF export of summaries. Ari quantified demand; Ivan shipped the export endpoint.",
    status: "released",
    startedAt: "12 days ago",
    updatedAt: "8 days ago",
    primaryBusinessArea: "Product",
    confidenceScore: 0.95,
    stages: [
      { type: "signal", label: "PDF export requests", completedAt: "12d ago", actor: "ari" },
      { type: "insight", label: "Top 3 requested feature", completedAt: "11d ago", actor: "ari" },
      { type: "engineering_task", label: "Export endpoint task", completedAt: "10d ago", actor: "ivan" },
      { type: "pr_opened", label: "PR #208 opened", completedAt: "9d ago", actor: "ivan" },
      { type: "pr_merged", label: "PR #208 merged", completedAt: "9d ago", actor: "ivan" },
      { type: "released", label: "Release v1.8.1", completedAt: "8d ago", actor: "system" },
    ],
  },
  {
    id: "s5",
    title: "Pricing Signal → Tier Adjustment",
    publicSummary:
      "Conversion signals indicated mid-tier pricing friction. Ari surfaced the gap; Ivan adjusted the billing flow.",
    status: "engineering_task",
    startedAt: "1 day ago",
    updatedAt: "2 hours ago",
    primaryBusinessArea: "Revenue",
    confidenceScore: 0.71,
    stages: [
      { type: "signal", label: "Pricing friction signals", completedAt: "1d ago", actor: "ari" },
      { type: "insight", label: "Mid-tier conversion gap", completedAt: "20h ago", actor: "ari" },
      { type: "engineering_task", label: "Billing flow task — in progress", actor: "ivan" },
      { type: "pr_opened", label: "Pending", actor: "ivan" },
      { type: "pr_merged", label: "Pending", actor: "ivan" },
      { type: "released", label: "Pending", actor: "system" },
    ],
  },
];

// ─── KPI Metrics ────────────────────────────────────────────────────────────

export const ariKpis: KpiMetric[] = [
  { label: "Signals captured", value: "143", delta: "+12%", deltaDir: "up", window: "7d" },
  { label: "Insights generated", value: "31", delta: "+8%", deltaDir: "up", window: "7d" },
  { label: "Emails sent", value: "2,847", delta: "+5%", deltaDir: "up", window: "7d" },
  { label: "Conversion signals", value: "18", delta: "+22%", deltaDir: "up", window: "7d" },
];

export const ivanKpis: KpiMetric[] = [
  { label: "PRs merged", value: "14", delta: "+3", deltaDir: "up", window: "7d" },
  { label: "Signal→PR", value: "2.4d", delta: "-0.8d", deltaDir: "up", window: "avg" },
  { label: "Tasks completed", value: "23", delta: "+4", deltaDir: "up", window: "7d" },
  { label: "Active tasks", value: "5", window: "now" },
];

// ─── Live Events ─────────────────────────────────────────────────────────────

export const liveEvents: LiveEvent[] = [
  { id: "e1", time: "2m ago", actor: "ivan", type: "pr_opened", text: "PR #221 opened — affiliate onboarding docs rewrite" },
  { id: "e2", time: "3h ago", actor: "ari", type: "insight", text: "Pricing friction insight: mid-tier drop-off at billing step 2" },
  { id: "e3", time: "6h ago", actor: "ivan", type: "pr_merged", text: "PR #218 merged — Redis response caching layer" },
  { id: "e4", time: "8h ago", actor: "ari", type: "signal", text: "API latency complaints trending up — 14 signals in 24h" },
  { id: "e5", time: "1d ago", actor: "ivan", type: "released", text: "Release v1.8.4 — usage summary email shipped" },
  { id: "e6", time: "1d ago", actor: "ari", type: "signal", text: "Churn intent detected in free-tier cohort — 2.1x baseline" },
  { id: "e7", time: "2d ago", actor: "ivan", type: "pr_merged", text: "PR #214 merged — free-tier usage summary email" },
  { id: "e8", time: "2d ago", actor: "ari", type: "insight", text: "Free-tier drop-off insight: 68% churn before summary view" },
];

// ─── Summary stats ───────────────────────────────────────────────────────────

export const summaryStats = {
  storiesThisWeek: 14,
  loopClosedPct: 87,
  avgSignalToPr: "2.4 days",
  prsThisWeek: 14,
  releaseNotesThisWeek: 4,
};
