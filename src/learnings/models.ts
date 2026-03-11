import { Schema } from 'effect';

const CanonicalRecordFields = {
  created_at: Schema.String,
  updated_at: Schema.String,
  sourcePath: Schema.String
} as const;

const RepoPathRequestFields = {
  repoPath: Schema.String
} as const;

export const RepositoryRecordSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('repository'),
  slug: Schema.String,
  name: Schema.String,
  local_path: Schema.optional(Schema.String),
  remote_url: Schema.optional(Schema.String),
  is_active: Schema.Boolean,
  ...CanonicalRecordFields
});
export type RepositoryRecord = typeof RepositoryRecordSchema.Type;

export const EvidenceRecordSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('evidence'),
  repository_id: Schema.String,
  source_system: Schema.String,
  source_type: Schema.String,
  external_id: Schema.optional(Schema.String),
  parent_external_id: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  pr_number: Schema.optional(Schema.Number),
  review_id: Schema.optional(Schema.String),
  thread_id: Schema.optional(Schema.String),
  comment_id: Schema.optional(Schema.String),
  author_type: Schema.optional(Schema.String),
  author_name: Schema.optional(Schema.String),
  author_role: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  content: Schema.String,
  file_path: Schema.optional(Schema.String),
  line_start: Schema.optional(Schema.Number),
  line_end: Schema.optional(Schema.Number),
  review_state: Schema.optional(Schema.String),
  resolution_state: Schema.optional(Schema.String),
  occurred_at: Schema.optional(Schema.String),
  base_weight: Schema.optional(Schema.Number),
  final_weight: Schema.optional(Schema.Number),
  boosts: Schema.Array(Schema.String),
  penalties: Schema.Array(Schema.String),
  ...CanonicalRecordFields
});
export type EvidenceRecord = typeof EvidenceRecordSchema.Type;

export const LearningRecordSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('learning'),
  repository_id: Schema.String,
  kind: Schema.String,
  source_type: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  statement: Schema.String,
  rationale: Schema.optional(Schema.String),
  applicability: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  status: Schema.String,
  evidence_ids: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  ...CanonicalRecordFields
});
export type LearningRecord = typeof LearningRecordSchema.Type;

export const CanonicalDatasetSchema = Schema.Struct({
  repositories: Schema.Array(RepositoryRecordSchema),
  evidence: Schema.Array(EvidenceRecordSchema),
  learnings: Schema.Array(LearningRecordSchema)
});
export type CanonicalDataset = typeof CanonicalDatasetSchema.Type;

export const LearningsRepositoryContextSchema = Schema.Struct({
  repoPath: Schema.String,
  repositoryId: Schema.String,
  repositorySlug: Schema.String,
  repositoryName: Schema.String,
  remoteUrl: Schema.optional(Schema.String),
  existingRecord: Schema.optional(RepositoryRecordSchema)
});
export type LearningsRepositoryContext =
  typeof LearningsRepositoryContextSchema.Type;

export const RepoPathRequestSchema = Schema.Struct(RepoPathRequestFields);
export type RepoPathRequest = typeof RepoPathRequestSchema.Type;

export const InitRequestSchema = RepoPathRequestSchema;
export type InitRequest = RepoPathRequest;

export const InitResultSchema = Schema.Struct({
  repositoryId: Schema.String,
  repositoryFile: Schema.String,
  createdDirectories: Schema.Array(Schema.String),
  gitignoreUpdated: Schema.Boolean,
  createdRepositoryRecord: Schema.Boolean
});
export type InitResult = typeof InitResultSchema.Type;

export const RebuildRequestSchema = RepoPathRequestSchema;
export type RebuildRequest = RepoPathRequest;

export const RebuildResultSchema = Schema.Struct({
  dbPath: Schema.String,
  repositoryCount: Schema.Number,
  evidenceCount: Schema.Number,
  learningCount: Schema.Number
});
export type RebuildResult = typeof RebuildResultSchema.Type;

export const QueryRequestSchema = Schema.Struct({
  repoPath: Schema.String,
  text: Schema.String,
  limit: Schema.optional(Schema.Number)
});
export type QueryRequest = typeof QueryRequestSchema.Type;

export const LearningEvidenceViewSchema = Schema.Struct({
  id: Schema.String,
  sourceType: Schema.String,
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  content: Schema.String,
  finalWeight: Schema.optional(Schema.Number)
});
export type LearningEvidenceView = typeof LearningEvidenceViewSchema.Type;

export const LearningViewSchema = Schema.Struct({
  id: Schema.String,
  repositoryId: Schema.String,
  title: Schema.optional(Schema.String),
  kind: Schema.String,
  statement: Schema.String,
  rationale: Schema.optional(Schema.String),
  applicability: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  status: Schema.String,
  tags: Schema.Array(Schema.String),
  evidence: Schema.Array(LearningEvidenceViewSchema)
});
export type LearningView = typeof LearningViewSchema.Type;
