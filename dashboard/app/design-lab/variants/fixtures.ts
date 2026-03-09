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
  outcome?: string;
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
  context?: string;
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
    title: "STEM paper quality → domain-aware summarization",
    publicSummary:
      "Three PhD researchers flagged inconsistent summary quality for chemistry papers in the same week's exit surveys — enough for Ari to call it a pattern, not noise. Root cause: the prompt pipeline treated every paper the same regardless of scientific domain. Ari quantified the gap at 22% below average on internal quality benchmarks. Ivan shipped domain detection and specialized prompt templates for STEM fields in 1.9 days. Chemistry quality is up 18%. Zero domain-related support tickets since the deploy.",
    status: "released",
    startedAt: "Feb 28",
    updatedAt: "Mar 5",
    primaryBusinessArea: "Retention",
    confidenceScore: 0.94,
    outcome: "+18% chemistry summary quality · 0 domain complaints since deploy",
    stages: [
      { type: "signal", label: "3 PhD exit surveys: chemistry quality", completedAt: "Feb 28", actor: "ari" },
      { type: "insight", label: "Domain-blind prompts → 22% quality gap", completedAt: "Mar 1", actor: "ari" },
      { type: "engineering_task", label: "STEM prompt routing task", completedAt: "Mar 2", actor: "ivan" },
      { type: "pr_opened", label: "PR #204 opened", completedAt: "Mar 3", actor: "ivan" },
      { type: "pr_merged", label: "PR #204 merged · 1.9 days", completedAt: "Mar 4", actor: "ivan" },
      { type: "released", label: "v1.9.0 shipped", completedAt: "Mar 5", actor: "system" },
    ],
  },
  {
    id: "s2",
    title: "Homepage conversion plateau → hero A/B test",
    publicSummary:
      "Signup conversion had been flat for three consecutive weeks. Ari noticed the homepage hero copy described SciSummary as a reading tool, not a research accelerator — a framing mismatch for the PhD and faculty users actually converting. Ivan wired a Pennant feature flag in 1.5 days so variant B could be deployed and queried directly from the features table. Variant B is showing +14% click-through on mobile vs. the control. The experiment is live.",
    status: "released",
    startedAt: "Feb 20",
    updatedAt: "Feb 23",
    primaryBusinessArea: "Conversion",
    confidenceScore: 0.88,
    outcome: "Variant B +14% mobile CTR · experiment day 14 · trending to ship",
    stages: [
      { type: "signal", label: "3-week signup conversion plateau", completedAt: "Feb 20", actor: "ari" },
      { type: "insight", label: "Hero copy: 'reader' framing vs. 'researcher'", completedAt: "Feb 21", actor: "ari" },
      { type: "engineering_task", label: "Pennant feature flag A/B wiring", completedAt: "Feb 22", actor: "ivan" },
      { type: "pr_opened", label: "PR #290 opened", completedAt: "Feb 22", actor: "ivan" },
      { type: "pr_merged", label: "PR #290 merged · 1.5 days", completedAt: "Feb 23", actor: "ivan" },
      { type: "released", label: "Experiment live", completedAt: "Feb 23", actor: "system" },
    ],
  },
  {
    id: "s3",
    title: "Paper library overload → Smart Filter (GPT-4 relevance screening)",
    publicSummary:
      "Power users — researchers and faculty with libraries of 100+ papers — were abandoning their libraries rather than triaging them manually. Ari surfaced the friction from support and usage signals. Ivan built a full async pipeline: a queued GPT-4 relevance-checking job (CheckPaperRelevance), a GPT4RelevanceChecker service, broadcast events for live UI updates, and Vue pages for index, list, and show. Shipped in 1.9 days. The system now processes 340 papers per hour at p95 1.2s.",
    status: "released",
    startedAt: "Mar 2",
    updatedAt: "Mar 4",
    primaryBusinessArea: "Engagement / LTV",
    confidenceScore: 0.91,
    outcome: "340 papers/hr · p95 1.2s · zero queue failures in first 5 days",
    stages: [
      { type: "signal", label: "Power users abandoning large libraries", completedAt: "Mar 2", actor: "ari" },
      { type: "insight", label: "No relevance layer → manual triage → abandonment", completedAt: "Mar 2", actor: "ari" },
      { type: "engineering_task", label: "GPT-4 relevance job + broadcast pipeline", completedAt: "Mar 2", actor: "ivan" },
      { type: "pr_opened", label: "PR #294 opened", completedAt: "Mar 2", actor: "ivan" },
      { type: "pr_merged", label: "PR #294 merged · 1.9 days", completedAt: "Mar 4", actor: "ivan" },
      { type: "released", label: "Smart Filter live", completedAt: "Mar 4", actor: "system" },
    ],
  },
  {
    id: "s4",
    title: "Day-7 churn spike → onboarding email sequence",
    publicSummary:
      "Cohort analysis showed a 34% user drop at day 7. Ari cross-referenced this with feature adoption data: users who never discovered the ChatGPT connector had 2.4× the churn rate of those who did. The connector is SciSummary's stickiest surface — but most new users never find it. Ivan already shipped a post-signup email redesign (PR #287, 24 files). Now building a 7-day sequence that surfaces the connector at the right moment.",
    status: "engineering_task",
    startedAt: "Mar 5",
    updatedAt: "Mar 8",
    primaryBusinessArea: "Retention / LTV",
    confidenceScore: 0.83,
    stages: [
      { type: "signal", label: "Day-7 cohort: 34% drop, 2.4× churn w/o connector", completedAt: "Mar 5", actor: "ari" },
      { type: "insight", label: "ChatGPT connector = stickiness signal #1", completedAt: "Mar 6", actor: "ari" },
      { type: "engineering_task", label: "7-day onboarding sequence — in progress", actor: "ivan" },
      { type: "pr_opened", label: "Pending", actor: "ivan" },
      { type: "pr_merged", label: "Pending", actor: "ivan" },
      { type: "released", label: "Pending", actor: "system" },
    ],
  },
  {
    id: "s5",
    title: "Affiliate trust gap → Rewardful click-to-conversion dashboard",
    publicSummary:
      "SciSummary's affiliate program pays up to 80% commission on the first two payments per referred user. Top affiliates drive 28% of new signups — but they had no way to verify whether their clicks were converting to paid users. Ari flagged the trust erosion and estimated $1,200 MRR at risk if the top three affiliates lost confidence. Ivan is building a real-time conversion funnel using existing Rewardful webhooks, exposing the full click → signup → paid chain without new API contracts.",
    status: "pr_opened",
    startedAt: "Mar 6",
    updatedAt: "Mar 8",
    primaryBusinessArea: "Affiliate / Growth",
    confidenceScore: 0.86,
    stages: [
      { type: "signal", label: "6 affiliates: no click-to-paid visibility", completedAt: "Mar 6", actor: "ari" },
      { type: "insight", label: "$1.2k MRR at risk · top-3 affiliate churn", completedAt: "Mar 7", actor: "ari" },
      { type: "engineering_task", label: "Rewardful click→paid funnel view", completedAt: "Mar 7", actor: "ivan" },
      { type: "pr_opened", label: "PR #296 in review", completedAt: "Mar 8", actor: "ivan" },
      { type: "pr_merged", label: "Pending merge", actor: "ivan" },
      { type: "released", label: "Pending deploy", actor: "system" },
    ],
  },
];

// ─── KPI Metrics ────────────────────────────────────────────────────────────

// Ari: demand intelligence across the full customer lifecycle
export const ariKpis: KpiMetric[] = [
  {
    label: "Demand signals",
    value: "47",
    delta: "+12",
    deltaDir: "up",
    window: "7d",
    context: "exit surveys, support, and usage anomalies surfaced",
  },
  {
    label: "Conversion signals",
    value: "8",
    delta: "+3",
    deltaDir: "up",
    window: "7d",
    context: "signup funnel friction points identified this week",
  },
  {
    label: "Churn signals open",
    value: "3",
    delta: "−4",
    deltaDir: "down",
    window: "7d",
    context: "active retention risks — down from 7 last week",
  },
  {
    label: "Signal → task",
    value: "1.8d",
    delta: "−0.4d",
    deltaDir: "up",
    window: "avg",
    context: "customer pain to Ivan's task queue",
  },
];

// Ivan: shipping grounded in real PR data and AI ops metrics from the research
export const ivanKpis: KpiMetric[] = [
  {
    label: "PRs merged",
    value: "14",
    delta: "+3",
    deltaDir: "up",
    window: "7d",
    context: "median 0.34 days open before merge",
  },
  {
    label: "Signal → PR",
    value: "2.4d",
    delta: "−0.6d",
    deltaDir: "up",
    window: "avg",
    context: "full loop: customer pain to shipped code",
  },
  {
    label: "AI job success",
    value: "99.2%",
    delta: "+0.4%",
    deltaDir: "up",
    window: "7d",
    context: "summarization + Smart Filter jobs completing cleanly",
  },
  {
    label: "Cost / summary",
    value: "$0.003",
    delta: "−68%",
    deltaDir: "up",
    window: "vs. GPT-4",
    context: "GPT-4.1-mini rollout (#205) cut AI infra spend",
  },
];

// ─── Live Events ─────────────────────────────────────────────────────────────
// Specific, outcome-connected, written for a public ops audience.

export const liveEvents: LiveEvent[] = [
  {
    id: "e1", time: "09:14", actor: "ari", type: "signal",
    text: "Exit survey cluster: 3 PhD researchers cited inconsistent chemistry paper quality in the same week. Churn risk flagged — 2 accounts on monthly plans, 1 evaluating renewal.",
  },
  {
    id: "e2", time: "09:31", actor: "ari", type: "insight",
    text: "Confirmed: prompt routing ignores domain metadata entirely. Chemistry and biology papers score 22% below baseline on internal quality benchmarks. Affected user segment: 340 STEM researchers (~12% of active base).",
  },
  {
    id: "e3", time: "09:45", actor: "ivan", type: "engineering_task",
    text: "Task scoped: domain detection + STEM-specific prompt templates. ETA 1.5 days. No new dependencies — extending existing summarization pipeline. 3 retention signals linked.",
  },
  {
    id: "e4", time: "11:02", actor: "ivan", type: "pr_opened",
    text: "PR #204 opened: domain-aware prompt routing for STEM fields. Adds GPT4DomainDetector, prompt template registry, and fallback for unknown domains. Internal benchmark: +18% on chemistry test set.",
  },
  {
    id: "e5", time: "14:20", actor: "ivan", type: "pr_merged",
    text: "PR #204 merged and shipped in v1.9.0. 1.9 days from signal to production. Zero domain-related support tickets in the 5 days since. Chemistry quality benchmark holding at +18%.",
  },
  {
    id: "e6", time: "15:10", actor: "ari", type: "signal",
    text: "Homepage A/B: Variant B (researcher-first framing) showing +14% click-through on mobile vs. control, day 14 of experiment. Statistical significance reached. Recommend shipping Variant B as default.",
  },
  {
    id: "e7", time: "15:44", actor: "ari", type: "insight",
    text: "Affiliate program risk: top-3 affiliates drive 28% of new signups and earn up to 80% commission on first two payments. None can verify their click-to-paid rate. Estimated $1,200 MRR at risk if trust erodes.",
  },
  {
    id: "e8", time: "16:00", actor: "ivan", type: "engineering_task",
    text: "Task: expose Rewardful click→signup→paid chain via existing webhooks. No new API contracts needed. Building on existing RewardfulService. ETA 2 days. PR #296 will surface the full funnel to affiliates.",
  },
];

// ─── Summary stats ───────────────────────────────────────────────────────────

export const summaryStats = {
  storiesThisWeek: 5,
  loopClosedPct: 87,
  avgSignalToPr: "2.4d",
  mrrGrowth: "+11%",
  activationRate: "68%",    // % of signups who summarize a paper in first 24h
  aiJobSuccess: "99.2%",
  churnSignalsOpen: 3,
};
