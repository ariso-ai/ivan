import { Schema } from 'effect';

export class RepoPathNotFound extends Schema.TaggedError<RepoPathNotFound>()(
  'RepoPathNotFound',
  {
    repoPath: Schema.String
  }
) {}

export class RepoPathNotDirectory extends Schema.TaggedError<RepoPathNotDirectory>()(
  'RepoPathNotDirectory',
  {
    repoPath: Schema.String
  }
) {}

export class MissingLearningsDatabase extends Schema.TaggedError<MissingLearningsDatabase>()(
  'MissingLearningsDatabase',
  {
    dbPath: Schema.String
  }
) {}

export class CanonicalDecodeError extends Schema.TaggedError<CanonicalDecodeError>()(
  'CanonicalDecodeError',
  {
    sourcePath: Schema.String,
    message: Schema.String
  }
) {}

export class InvariantViolation extends Schema.TaggedError<InvariantViolation>()(
  'InvariantViolation',
  {
    issues: Schema.Array(Schema.String)
  }
) {}

export class QueryTextEmpty extends Schema.TaggedError<QueryTextEmpty>()(
  'QueryTextEmpty',
  {}
) {}

export class InvalidQueryLimit extends Schema.TaggedError<InvalidQueryLimit>()(
  'InvalidQueryLimit',
  {
    limit: Schema.Number
  }
) {}

export class LearningsIoError extends Schema.TaggedError<LearningsIoError>()(
  'LearningsIoError',
  {
    operation: Schema.String,
    message: Schema.String,
    path: Schema.optional(Schema.String)
  }
) {}

export class LearningsPersistenceError extends Schema.TaggedError<LearningsPersistenceError>()(
  'LearningsPersistenceError',
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export type LearningsError =
  | RepoPathNotFound
  | RepoPathNotDirectory
  | MissingLearningsDatabase
  | CanonicalDecodeError
  | InvariantViolation
  | QueryTextEmpty
  | InvalidQueryLimit
  | LearningsIoError
  | LearningsPersistenceError;
