---
id: "ev_lock-await"
repository_id: "repo_sample-repo"
source_system: "github"
source_type: "pr_review_comment"
external_id: "123456789"
url: "https://github.com/example/sample-repo/pull/15#discussion_r123456789"
pr_number: 15
author_type: "human"
author_name: "reviewer"
author_role: "reviewer"
file_path: "src/worker.ts"
line_start: 84
line_end: 84
review_state: "CHANGES_REQUESTED"
resolution_state: "resolved"
occurred_at: "2026-03-09T12:15:00Z"
base_weight: 3
final_weight: 11
boosts:
  - "author_acknowledgement"
  - "addressed_change"
penalties: []
created_at: "2026-03-09T12:20:00Z"
updated_at: "2026-03-09T12:20:00Z"
---
This lock is held across an await. That can deadlock under load.
Prefer copying the data and releasing the lock before the async call.
