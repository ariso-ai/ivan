---
id: "ev_lock-await-ack"
repository_id: "repo_sample-repo"
source_system: "github"
source_type: "pr_review_reply"
external_id: "123456790"
parent_external_id: "123456789"
url: "https://github.com/example/sample-repo/pull/15#discussion_r123456790"
pr_number: 15
author_type: "human"
author_name: "author"
author_role: "author"
occurred_at: "2026-03-09T12:25:00Z"
base_weight: 4
final_weight: 8
boosts:
  - "author_acknowledgement"
penalties: []
created_at: "2026-03-09T12:25:00Z"
updated_at: "2026-03-09T12:25:00Z"
---
Good catch. I rewrote the handler so the lock is released before the await.
