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
// Real SciSummary product loops: customer signal → Ari insight → Ivan ships it

export const stories: Story[] = [
  {
    id: "s1",
    title: "Chemistry paper quality → domain-aware summarization",
    publicSummary:
      "3 PhD researchers cited inconsistent quality on chemistry papers in exit surveys. Ari traced it to missing domain context in prompt routing. Ivan shipped specialized prompt templates for STEM fields.",
    status: "released",
    startedAt: "Feb 28",
    updatedAt: "Mar 5",
    primaryBusinessArea: "Retention",
    confidenceScore: 0.94,
    stages: [
      { type: "signal", label: "Churn signal: chemistry quality", completedAt: "Feb 28", actor: "ari" },
      { type: "insight", label: "Domain prompt gap identified", completedAt: "Mar 1", actor: "ari" },
      { type: "engineering_task", label: "Domain-aware routing task", completedAt: "Mar 2", actor: "ivan" },
      { type: "pr_opened", label: "PR #204 opened", completedAt: "Mar 3", actor: "ivan" },
      { type: "pr_merged", label: "PR #204 merged", completedAt: "Mar 4", actor: "ivan" },
      { type: "released", label: "v1.9.0 shipped", completedAt: "Mar 5", actor: "system" },
    ],
  },
  {
    id: "s2",
    title: "PDF upload latency — p95 8s → 2.1s",
    publicSummary:
      "Activation drop-off correlated with upload wait time. 4 users cited 'too slow' as their downgrade reason in the same week. Ivan optimized the PDF parsing pipeline; activation rate up 9 points.",
    status: "released",
    startedAt: "Mar 1",
    updatedAt: "Mar 7",
    primaryBusinessArea: "Activation",
    confidenceScore: 0.91,
    stages: [
      { type: "signal", label: "Slow upload → downgrade signals", completedAt: "Mar 1", actor: "ari" },
      { type: "insight", label: "Upload time → activation link", completedAt: "Mar 2", actor: "ari" },
      { type: "engineering_task", label: "PDF parser optimization", completedAt: "Mar 3", actor: "ivan" },
      { type: "pr_opened", label: "PR #209 opened", completedAt: "Mar 5", actor: "ivan" },
      { type: "pr_merged", label: "PR #209 merged", completedAt: "Mar 6", actor: "ivan" },
      { type: "released", label: "v1.9.1 shipped", completedAt: "Mar 7", actor: "system" },
    ],
  },
  {
    id: "s3",
    title: "Affiliate click-to-conversion tracking",
    publicSummary:
      "6 affiliates couldn't verify whether their clicks converted to paid users. Program trust at risk — top affiliates drive 28% of new signups. Ivan built a real-time conversion funnel view.",
    status: "pr_merged",
    startedAt: "Mar 3",
    updatedAt: "Mar 8",
    primaryBusinessArea: "Affiliate / Growth",
    confidenceScore: 0.88,
    stages: [
      { type: "signal", label: "Affiliate trust signals", completedAt: "Mar 3", actor: "ari" },
      { type: "insight", label: "$1.2k MRR at risk from top affiliates", completedAt: "Mar 4", actor: "ari" },
      { type: "engineering_task", label: "Conversion funnel dashboard", completedAt: "Mar 5", actor: "ivan" },
      { type: "pr_opened", label: "PR #214 opened", completedAt: "Mar 7", actor: "ivan" },
      { type: "pr_merged", label: "PR #214 merged", completedAt: "Mar 8", actor: "ivan" },
      { type: "released", label: "Pending deploy", actor: "system" },
    ],
  },
  {
    id: "s4",
    title: "Day-7 retention: onboarding email sequence",
    publicSummary:
      "Cohort analysis showed 34% drop at day 7. Ari identified users who never discovered the ChatGPT connector had 2.4× higher churn. Retention sequence now nudges new users toward it in week 1.",
    status: "engineering_task",
    startedAt: "Mar 5",
    updatedAt: "Mar 8",
    primaryBusinessArea: "Retention / LTV",
    confidenceScore: 0.82,
    stages: [
      { type: "signal", label: "Day-7 churn cohort spike", completedAt: "Mar 5", actor: "ari" },
      { type: "insight", label: "ChatGPT connector discovery gap", completedAt: "Mar 6", actor: "ari" },
      { type: "engineering_task", label: "Onboarding email sequence — in progress", actor: "ivan" },
      { type: "pr_opened", label: "Pending", actor: "ivan" },
      { type: "pr_merged", label: "Pending", actor: "ivan" },
      { type: "released", label: "Pending", actor: "system" },
    ],
  },
  {
    id: "s5",
    title: "Cost / summary reduction via prompt caching",
    publicSummary:
      "Gross margin compression as usage scaled. Ari flagged the unit economics trend from infrastructure cost vs. ARPU data. Ivan introduced prompt caching for repeated system context, cutting per-summary cost ~30%.",
    status: "insight",
    startedAt: "Mar 7",
    updatedAt: "Mar 9",
    primaryBusinessArea: "Unit Economics",
    confidenceScore: 0.76,
    stages: [
      { type: "signal", label: "Margin compression signal", completedAt: "Mar 7", actor: "ari" },
      { type: "insight", label: "Prompt caching opportunity", completedAt: "Mar 8", actor: "ari" },
      { type: "engineering_task", label: "Pending task creation", actor: "ivan" },
      { type: "pr_opened", label: "Pending", actor: "ivan" },
      { type: "pr_merged", label: "Pending", actor: "ivan" },
      { type: "released", label: "Pending", actor: "system" },
    ],
  },
];

// ─── KPI Metrics ────────────────────────────────────────────────────────────

// Ari monitors the business: customer demand, product signals, revenue health
export const ariKpis: KpiMetric[] = [
  { label: "Demand signals", value: "47", delta: "+12", deltaDir: "up", window: "7d" },
  { label: "Insights → tasks", value: "11", delta: "+3", deltaDir: "up", window: "7d" },
  { label: "Churn signals", value: "6", delta: "−2", deltaDir: "down", window: "7d" },
  { label: "Signal → task", value: "1.8d", delta: "−0.4d", deltaDir: "up", window: "avg" },
];

// Ivan tracks engineering output + business-outcome metrics
export const ivanKpis: KpiMetric[] = [
  { label: "PRs merged", value: "14", delta: "+3", deltaDir: "up", window: "7d" },
  { label: "Signal → PR", value: "2.4d", delta: "−0.6d", deltaDir: "up", window: "avg" },
  { label: "p95 latency", value: "2.1s", delta: "−5.9s", deltaDir: "up", window: "current" },
  { label: "Cost / summary", value: "$0.003", delta: "−30%", deltaDir: "up", window: "current" },
];

// ─── Live Events ─────────────────────────────────────────────────────────────

export const liveEvents: LiveEvent[] = [
  {
    id: "e1", time: "09:14", actor: "ari", type: "signal",
    text: "3 PhD researchers cited 'inconsistent quality on chemistry papers' in exit surveys this week. Churn risk: high.",
  },
  {
    id: "e2", time: "09:31", actor: "ari", type: "insight",
    text: "Root cause: prompt routing ignores domain metadata. Chemistry + biology papers under-perform by 22% on quality benchmarks.",
  },
  {
    id: "e3", time: "09:45", actor: "ivan", type: "engineering_task",
    text: "Task created: domain-aware prompt routing. Estimated 1.5 days. Linked to 3 retention signals and $800 MRR at risk.",
  },
  {
    id: "e4", time: "11:02", actor: "ivan", type: "pr_opened",
    text: "PR #204 opened: Add domain detection + specialized prompt templates for STEM fields. p50 quality +18% on test set.",
  },
  {
    id: "e5", time: "14:20", actor: "ivan", type: "pr_merged",
    text: "PR #204 merged. Domain routing live in staging. Chemistry quality benchmark +18%. Deploying with v1.9.0.",
  },
  {
    id: "e6", time: "15:10", actor: "ari", type: "signal",
    text: "6 affiliates asked for click-to-paid conversion visibility. Top affiliates drive 28% of new signups — program trust at risk.",
  },
  {
    id: "e7", time: "15:44", actor: "ari", type: "insight",
    text: "Estimated $1,200 MRR at risk if top-3 affiliates churn from the program. Rewardful has the data; we need a funnel view.",
  },
  {
    id: "e8", time: "16:00", actor: "ivan", type: "engineering_task",
    text: "Task: real-time affiliate conversion funnel using Rewardful webhooks. ETA 2 days. Will surface click → signup → paid chain.",
  },
];

// ─── Summary stats (collaboration view) ─────────────────────────────────────

export const summaryStats = {
  storiesThisWeek: 5,
  loopClosedPct: 87,
  avgSignalToPr: "2.4d",
  // Business metrics for business context bar
  mrrGrowth: "+11%",
  activationRate: "68%",
  churnSignalsOpen: 3,
};
