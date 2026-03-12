import { FileSystem, Path } from '@effect/platform';
import { Context, Effect, Layer } from 'effect';
import {
  CanonicalDecodeError,
  InvariantViolation,
  LearningsIoError,
  LearningsPersistenceError,
  RepoPathNotDirectory,
  RepoPathNotFound
} from './errors.js';
import { createRepositoryId, slugify } from './ids.js';
import type {
  CanonicalDataset,
  EvidenceRecord,
  InitResult,
  LearningRecord,
  LearningsRepositoryContext,
  RepositoryRecord
} from './models.js';
import type { LearningsError } from './errors.js';
import { GitMetadata } from './git-metadata.js';
import { withOptionalFields } from './models.js';

type JsonlRecord = Record<string, unknown>;

export class CanonicalStore extends Context.Tag(
  '@ivan/learnings/CanonicalStore'
)<
  CanonicalStore,
  {
    readonly load: (
      repoPath: string
    ) => Effect.Effect<CanonicalDataset, LearningsError>;
    readonly init: (
      repoPath: string
    ) => Effect.Effect<InitResult, LearningsError>;
    readonly resolveContext: (
      repoPath: string
    ) => Effect.Effect<LearningsRepositoryContext, LearningsError>;
    readonly writeLearnings: (
      repoPath: string,
      repositoryId: string,
      records: ReadonlyArray<LearningRecord>
    ) => Effect.Effect<ReadonlyArray<string>, LearningsError>;
    readonly writeEvidence: (
      repoPath: string,
      repositoryId: string,
      records: ReadonlyArray<EvidenceRecord>
    ) => Effect.Effect<ReadonlyArray<string>, LearningsError>;
  }
>() {}

export const CanonicalStoreLive = Layer.effect(
  CanonicalStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitMetadata;

    const loadRaw = Effect.fn('CanonicalStore.load')(function* (
      repoPath: string
    ) {
      const resolvedRepoPath = yield* assertRepoPath(repoPath);

      return {
        repositories: yield* readRepositoryRecords(resolvedRepoPath),
        evidence: yield* readEvidenceRecords(resolvedRepoPath),
        learnings: yield* readLearningRecords(resolvedRepoPath)
      } satisfies CanonicalDataset;
    });
    const load = (repoPath: string) =>
      loadRaw(repoPath).pipe(
        Effect.mapError((error) =>
          toStoreError(`load canonical records for ${repoPath}`, error)
        )
      );

    const resolveContextRaw = Effect.fn('CanonicalStore.resolveContext')(
      function* (repoPath: string) {
        const resolvedRepoPath = yield* assertRepoPath(repoPath);
        const existingRecords = yield* readRepositoryRecords(resolvedRepoPath);
        const existingRecord = selectExistingRepositoryRecord(
          existingRecords,
          resolvedRepoPath
        );

        const repositoryName =
          existingRecord?.name ?? path.basename(resolvedRepoPath);
        const repositorySlug =
          existingRecord?.slug ?? slugify(path.basename(resolvedRepoPath));
        const repositoryId =
          existingRecord?.id ?? createRepositoryId(repositorySlug);
        const remoteUrl =
          existingRecord?.remote_url ??
          (yield* git.remoteOriginUrl(resolvedRepoPath));

        return withOptionalFields<LearningsRepositoryContext>(
          {
            repoPath: resolvedRepoPath,
            repositoryId,
            repositorySlug,
            repositoryName
          },
          {
            remoteUrl,
            existingRecord
          }
        );
      }
    );
    const resolveContext = (repoPath: string) =>
      resolveContextRaw(repoPath).pipe(
        Effect.mapError((error) =>
          toStoreError(`resolve learnings context for ${repoPath}`, error)
        )
      );

    const initRaw = Effect.fn('CanonicalStore.init')(function* (
      repoPath: string
    ) {
      const context = yield* resolveContext(repoPath);
      const resolvedRepoPath = context.repoPath;
      const existingRecords = yield* readRepositoryRecords(resolvedRepoPath);

      const now = new Date().toISOString();

      const directories = [
        path.join(resolvedRepoPath, 'learnings'),
        path.join(resolvedRepoPath, 'learnings', 'evidence'),
        path.join(resolvedRepoPath, 'learnings', 'lessons')
      ];
      const createdDirectories: string[] = [];

      for (const directory of directories) {
        const exists = yield* fs.exists(directory);
        if (!exists) {
          yield* fs.makeDirectory(directory, { recursive: true });
          createdDirectories.push(directory);
        }
      }

      const repositoryRecord: RepositoryRecord = withOptionalFields(
        {
          type: 'repository',
          sourcePath: 'learnings/repositories.jsonl',
          id: context.repositoryId,
          slug: context.repositorySlug,
          name: context.repositoryName,
          local_path: resolvedRepoPath,
          is_active: true,
          created_at: context.existingRecord?.created_at ?? now,
          updated_at: now
        },
        {
          remote_url: context.remoteUrl
        }
      );

      const repositoriesFile = path.join(
        resolvedRepoPath,
        'learnings',
        'repositories.jsonl'
      );
      const createdRepositoryRecord = !existingRecords.some(
        (record) => record.id === repositoryRecord.id
      );
      const mergedRecords = [
        ...existingRecords.filter(
          (record) => record.id !== repositoryRecord.id
        ),
        repositoryRecord
      ]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((record) => serializeRepositoryRecord(record));

      yield* writeJsonlFile(repositoriesFile, mergedRecords);
      yield* Effect.ignore(
        fs.remove(path.join(resolvedRepoPath, 'learnings', 'repositories'), {
          recursive: true,
          force: true
        })
      );

      const gitignorePath = path.join(resolvedRepoPath, '.gitignore');
      const existingGitignore = (yield* fs.exists(gitignorePath))
        ? yield* fs.readFileString(gitignorePath)
        : '';
      const normalizedGitignore = existingGitignore.replace(/\r\n/g, '\n');
      const existingLines = new Set(normalizedGitignore.split('\n'));
      const missingPatterns = ['learnings.db', 'learnings.db-*'].filter(
        (pattern) => !existingLines.has(pattern)
      );
      const gitignoreUpdated = missingPatterns.length > 0;

      if (gitignoreUpdated) {
        const nextContent =
          normalizedGitignore.trimEnd().length > 0
            ? `${normalizedGitignore.trimEnd()}\n\n# Derived learnings database\n${missingPatterns.join('\n')}\n`
            : `# Derived learnings database\n${missingPatterns.join('\n')}\n`;
        yield* fs.writeFileString(gitignorePath, nextContent);
      }

      return {
        repositoryId: context.repositoryId,
        repositoryFile: repositoriesFile,
        createdDirectories,
        gitignoreUpdated,
        createdRepositoryRecord
      } satisfies InitResult;
    });
    const init = (repoPath: string) =>
      initRaw(repoPath).pipe(
        Effect.mapError((error) =>
          toStoreError(`initialize learnings store for ${repoPath}`, error)
        )
      );

    const writeLearningsRaw = Effect.fn('CanonicalStore.writeLearnings')(
      function* (
        repoPath: string,
        repositoryId: string,
        records: ReadonlyArray<LearningRecord>
      ) {
        const resolvedRepoPath = yield* assertRepoPath(repoPath);
        const lessonsDir = path.join(resolvedRepoPath, 'learnings', 'lessons');
        yield* fs.makeDirectory(lessonsDir, { recursive: true });

        const filePath = path.join(lessonsDir, `${repositoryId}.jsonl`);
        const normalizedRecords = [...records]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((record) => ({
            ...record,
            sourcePath: `learnings/lessons/${repositoryId}.jsonl`
          }));

        yield* writeJsonlFile(
          filePath,
          normalizedRecords.map((record) => serializeLearningRecord(record))
        );
        yield* Effect.ignore(
          fs.remove(path.join(lessonsDir, repositoryId), {
            recursive: true,
            force: true
          })
        );

        return normalizedRecords.map(
          (_record, index) => `${filePath}#L${index + 1}`
        );
      }
    );
    const writeLearnings = (
      repoPath: string,
      repositoryId: string,
      records: ReadonlyArray<LearningRecord>
    ) =>
      writeLearningsRaw(repoPath, repositoryId, records).pipe(
        Effect.mapError((error) =>
          toStoreError(`write learning records for ${repoPath}`, error)
        )
      );

    const writeEvidenceRaw = Effect.fn('CanonicalStore.writeEvidence')(
      function* (
        repoPath: string,
        repositoryId: string,
        records: ReadonlyArray<EvidenceRecord>
      ) {
        const resolvedRepoPath = yield* assertRepoPath(repoPath);
        const evidenceDir = path.join(
          resolvedRepoPath,
          'learnings',
          'evidence'
        );
        yield* fs.makeDirectory(evidenceDir, { recursive: true });

        const filePath = path.join(evidenceDir, `${repositoryId}.jsonl`);
        const existingRecords = yield* readJsonlFile(
          filePath,
          resolvedRepoPath,
          (sourcePath, record) => parseEvidenceRecord(sourcePath, record)
        );
        const byId = new Map<string, EvidenceRecord>();

        for (const record of existingRecords) {
          byId.set(record.id, record);
        }
        for (const record of records) {
          byId.set(record.id, {
            ...record,
            sourcePath: `learnings/evidence/${repositoryId}.jsonl`
          });
        }

        const mergedRecords = [...byId.values()]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((record) => ({
            ...record,
            sourcePath: `learnings/evidence/${repositoryId}.jsonl`
          }));

        yield* writeJsonlFile(
          filePath,
          mergedRecords.map((record) => serializeEvidenceRecord(record))
        );
        yield* Effect.ignore(
          fs.remove(path.join(evidenceDir, repositoryId), {
            recursive: true,
            force: true
          })
        );

        return mergedRecords.map(
          (_record, index) => `${filePath}#L${index + 1}`
        );
      }
    );
    const writeEvidence = (
      repoPath: string,
      repositoryId: string,
      records: ReadonlyArray<EvidenceRecord>
    ) =>
      writeEvidenceRaw(repoPath, repositoryId, records).pipe(
        Effect.mapError((error) =>
          toStoreError(`write evidence records for ${repoPath}`, error)
        )
      );

    const assertRepoPath = Effect.fn('CanonicalStore.assertRepoPath')(
      function* (repoPath: string) {
        const resolvedRepoPath = path.resolve(repoPath);
        const exists = yield* fs.exists(resolvedRepoPath);
        if (!exists) {
          return yield* Effect.fail(
            new RepoPathNotFound({ repoPath: resolvedRepoPath })
          );
        }

        const info = yield* fs.stat(resolvedRepoPath);
        if (info.type !== 'Directory') {
          return yield* Effect.fail(
            new RepoPathNotDirectory({ repoPath: resolvedRepoPath })
          );
        }

        return resolvedRepoPath;
      }
    );

    const readRepositoryRecords = Effect.fn(
      'CanonicalStore.readRepositoryRecords'
    )(function* (repoPath: string) {
      const filePath = path.join(repoPath, 'learnings', 'repositories.jsonl');
      return yield* readJsonlFile(filePath, repoPath, (sourcePath, record) =>
        parseRepositoryRecord(sourcePath, record)
      );
    });

    const readEvidenceRecords = Effect.fn('CanonicalStore.readEvidenceRecords')(
      function* (repoPath: string) {
        return yield* readJsonlDirectory(
          path.join(repoPath, 'learnings', 'evidence'),
          repoPath,
          parseEvidenceRecord
        );
      }
    );

    const readLearningRecords = Effect.fn('CanonicalStore.readLearningRecords')(
      function* (repoPath: string) {
        return yield* readJsonlDirectory(
          path.join(repoPath, 'learnings', 'lessons'),
          repoPath,
          parseLearningRecord
        );
      }
    );

    const readJsonlDirectory = <T>(
      directory: string,
      repoPath: string,
      parser: (sourcePath: string, record: JsonlRecord) => T
    ) =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(directory);
        if (!exists) {
          return [] as T[];
        }

        const entries = (yield* fs.readDirectory(directory))
          .filter((entry) => entry.endsWith('.jsonl'))
          .sort((left, right) => left.localeCompare(right));
        const records: T[] = [];

        for (const entry of entries) {
          const filePath = path.join(directory, entry);
          records.push(...(yield* readJsonlFile(filePath, repoPath, parser)));
        }

        return records;
      });

    const readJsonlFile = <T>(
      filePath: string,
      repoPath: string,
      parser: (sourcePath: string, record: JsonlRecord) => T
    ) =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(filePath);
        if (!exists) {
          return [] as T[];
        }

        const content = yield* fs.readFileString(filePath, 'utf8');
        const sourceFile = path
          .relative(repoPath, filePath)
          .split(path.sep)
          .join('/');
        const records: T[] = [];
        const lines = content.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
          const rawLine = lines[index].trim();
          if (!rawLine) {
            continue;
          }

          const sourcePath = `${sourceFile}#L${index + 1}`;
          let parsed: JsonlRecord;
          try {
            const value = JSON.parse(rawLine) as unknown;
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              throw new Error('Expected JSON object');
            }
            parsed = value as JsonlRecord;
          } catch (error) {
            return yield* Effect.fail(
              new CanonicalDecodeError({
                sourcePath,
                message:
                  error instanceof Error ? error.message : 'Invalid JSON record'
              })
            );
          }

          try {
            records.push(parser(sourcePath, parsed));
          } catch (error) {
            if (error instanceof CanonicalDecodeError) {
              return yield* Effect.fail(error);
            }
            return yield* Effect.fail(
              new CanonicalDecodeError({
                sourcePath,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Could not decode canonical record'
              })
            );
          }
        }

        return records;
      });

    const writeJsonlFile = (
      filePath: string,
      records: ReadonlyArray<unknown>
    ) =>
      fs
        .writeFileString(
          filePath,
          records.map((record) => `${JSON.stringify(record)}\n`).join('')
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new LearningsPersistenceError({
                operation: `write ${filePath}`,
                message: error.message
              })
          )
        );

    return CanonicalStore.of({
      load,
      init,
      resolveContext,
      writeLearnings,
      writeEvidence
    } as any);
  })
);

function selectExistingRepositoryRecord(
  records: ReadonlyArray<RepositoryRecord>,
  repoPath: string
): RepositoryRecord | undefined {
  if (records.length === 0) {
    return undefined;
  }

  if (records.length === 1) {
    return records[0];
  }

  const matchingRecords = records.filter(
    (record) => record.local_path && record.local_path === repoPath
  );
  if (matchingRecords.length === 1) {
    return matchingRecords[0];
  }

  throw new CanonicalDecodeError({
    sourcePath: 'learnings/repositories.jsonl',
    message: `Expected a single repository record for ${repoPath}`
  });
}

function parseRepositoryRecord(
  sourcePath: string,
  record: JsonlRecord
): RepositoryRecord {
  return withOptionalFields<RepositoryRecord>(
    {
      type: 'repository',
      sourcePath,
      id: getRequiredString(record, 'id', sourcePath),
      slug: getRequiredString(record, 'slug', sourcePath),
      name: getRequiredString(record, 'name', sourcePath),
      is_active: getOptionalBoolean(record, 'is_active') ?? true,
      created_at: getRequiredString(record, 'created_at', sourcePath),
      updated_at: getRequiredString(record, 'updated_at', sourcePath)
    },
    {
      local_path: getOptionalString(record, 'local_path'),
      remote_url: getOptionalString(record, 'remote_url')
    }
  );
}

function parseEvidenceRecord(
  sourcePath: string,
  record: JsonlRecord
): EvidenceRecord {
  return withOptionalFields<EvidenceRecord>(
    {
      type: 'evidence',
      sourcePath,
      id: getRequiredString(record, 'id', sourcePath),
      repository_id: getRequiredString(record, 'repository_id', sourcePath),
      source_system: getRequiredString(record, 'source_system', sourcePath),
      source_type: getRequiredString(record, 'source_type', sourcePath),
      content: getRequiredString(record, 'content', sourcePath),
      boosts: getStringArray(record, 'boosts'),
      penalties: getStringArray(record, 'penalties'),
      created_at: getRequiredString(record, 'created_at', sourcePath),
      updated_at: getRequiredString(record, 'updated_at', sourcePath)
    },
    {
      external_id: getOptionalString(record, 'external_id'),
      parent_external_id: getOptionalString(record, 'parent_external_id'),
      url: getOptionalString(record, 'url'),
      pr_number: getOptionalNumber(record, 'pr_number', sourcePath),
      review_id: getOptionalString(record, 'review_id'),
      thread_id: getOptionalString(record, 'thread_id'),
      comment_id: getOptionalString(record, 'comment_id'),
      author_type: getOptionalString(record, 'author_type'),
      author_name: getOptionalString(record, 'author_name'),
      author_role: getOptionalString(record, 'author_role'),
      title: getOptionalString(record, 'title'),
      file_path: getOptionalString(record, 'file_path'),
      line_start: getOptionalNumber(record, 'line_start', sourcePath),
      line_end: getOptionalNumber(record, 'line_end', sourcePath),
      review_state: getOptionalString(record, 'review_state'),
      resolution_state: getOptionalString(record, 'resolution_state'),
      occurred_at: getOptionalString(record, 'occurred_at'),
      base_weight: getOptionalNumber(record, 'base_weight', sourcePath),
      final_weight: getOptionalNumber(record, 'final_weight', sourcePath)
    }
  );
}

function parseLearningRecord(
  sourcePath: string,
  record: JsonlRecord
): LearningRecord {
  return withOptionalFields<LearningRecord>(
    {
      type: 'learning',
      sourcePath,
      id: getRequiredString(record, 'id', sourcePath),
      repository_id: getRequiredString(record, 'repository_id', sourcePath),
      kind: getRequiredString(record, 'kind', sourcePath),
      statement: getRequiredString(record, 'statement', sourcePath),
      status: getOptionalString(record, 'status') ?? 'active',
      evidence_ids: getStringArray(record, 'evidence_ids'),
      tags: getStringArray(record, 'tags'),
      created_at: getRequiredString(record, 'created_at', sourcePath),
      updated_at: getRequiredString(record, 'updated_at', sourcePath)
    },
    {
      source_type: getOptionalString(record, 'source_type'),
      title: getOptionalString(record, 'title'),
      rationale: getOptionalString(record, 'rationale'),
      applicability: getOptionalString(record, 'applicability'),
      confidence: getOptionalNumber(record, 'confidence', sourcePath)
    }
  );
}

function serializeRepositoryRecord(
  record: RepositoryRecord
): Omit<RepositoryRecord, 'type' | 'sourcePath'> {
  return withOptionalFields(
    {
      id: record.id,
      slug: record.slug,
      name: record.name,
      is_active: record.is_active,
      created_at: record.created_at,
      updated_at: record.updated_at
    },
    {
      local_path: record.local_path,
      remote_url: record.remote_url
    }
  );
}

function serializeEvidenceRecord(
  record: EvidenceRecord
): Omit<EvidenceRecord, 'type' | 'sourcePath'> {
  return withOptionalFields(
    {
      id: record.id,
      repository_id: record.repository_id,
      source_system: record.source_system,
      source_type: record.source_type,
      boosts: record.boosts,
      penalties: record.penalties,
      created_at: record.created_at,
      updated_at: record.updated_at,
      content: record.content.trim()
    },
    {
      external_id: record.external_id,
      parent_external_id: record.parent_external_id,
      url: record.url,
      pr_number: record.pr_number,
      review_id: record.review_id,
      thread_id: record.thread_id,
      comment_id: record.comment_id,
      author_type: record.author_type,
      author_name: record.author_name,
      author_role: record.author_role,
      title: record.title,
      file_path: record.file_path,
      line_start: record.line_start,
      line_end: record.line_end,
      review_state: record.review_state,
      resolution_state: record.resolution_state,
      occurred_at: record.occurred_at,
      base_weight: record.base_weight,
      final_weight: record.final_weight
    }
  );
}

function serializeLearningRecord(
  record: LearningRecord
): Omit<LearningRecord, 'type' | 'sourcePath'> {
  return withOptionalFields(
    {
      id: record.id,
      repository_id: record.repository_id,
      kind: record.kind,
      statement: record.statement,
      status: record.status,
      evidence_ids: record.evidence_ids,
      tags: record.tags,
      created_at: record.created_at,
      updated_at: record.updated_at
    },
    {
      source_type: record.source_type,
      title: record.title,
      rationale: record.rationale,
      applicability: record.applicability,
      confidence: record.confidence
    }
  );
}

function getRequiredString(
  record: JsonlRecord,
  key: string,
  sourcePath: string
): string {
  const value = getOptionalString(record, key);
  if (!value) {
    throw new CanonicalDecodeError({
      sourcePath,
      message: `Missing required field "${key}"`
    });
  }

  return value;
}

function getOptionalString(
  record: JsonlRecord,
  key: string
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  return String(value).trim() || undefined;
}

function getOptionalNumber(
  record: JsonlRecord,
  key: string,
  sourcePath: string
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new CanonicalDecodeError({
      sourcePath,
      message: `Expected numeric field "${key}"`
    });
  }

  return parsed;
}

function getOptionalBoolean(
  record: JsonlRecord,
  key: string
): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function getStringArray(record: JsonlRecord, key: string): string[] {
  const value = record[key];
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (!Array.isArray(value)) {
    return [String(value).trim()].filter(Boolean);
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toStoreError(operation: string, error: unknown) {
  if (
    error instanceof RepoPathNotFound ||
    error instanceof RepoPathNotDirectory ||
    error instanceof CanonicalDecodeError ||
    error instanceof InvariantViolation ||
    error instanceof LearningsPersistenceError ||
    error instanceof LearningsIoError
  ) {
    return error;
  }

  return new LearningsIoError({
    operation,
    message: error instanceof Error ? error.message : String(error)
  });
}
