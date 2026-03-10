export interface CanonicalRecord {
  id: string;
  type: 'repository' | 'evidence' | 'learning';
  sourcePath: string;
  created_at: string;
  updated_at: string;
}

export interface RepositoryRecord extends CanonicalRecord {
  type: 'repository';
  slug: string;
  name: string;
  local_path?: string;
  remote_url?: string;
  is_active: boolean;
}

export interface EvidenceRecord extends CanonicalRecord {
  type: 'evidence';
  repository_id: string;
  source_system: string;
  source_type: string;
  external_id?: string;
  parent_external_id?: string;
  url?: string;
  pr_number?: number;
  review_id?: string;
  thread_id?: string;
  comment_id?: string;
  author_type?: string;
  author_name?: string;
  author_role?: string;
  title?: string;
  content: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  review_state?: string;
  resolution_state?: string;
  occurred_at?: string;
  base_weight?: number;
  final_weight?: number;
  boosts: string[];
  penalties: string[];
}

export interface LearningRecord extends CanonicalRecord {
  type: 'learning';
  repository_id: string;
  kind: string;
  source_type?: string;
  title?: string;
  statement: string;
  rationale?: string;
  applicability?: string;
  confidence?: number;
  status: string;
  evidence_ids: string[];
  tags: string[];
}

export interface LearningsDataset {
  repositories: RepositoryRecord[];
  evidence: EvidenceRecord[];
  learnings: LearningRecord[];
}
