export type LearningsScalar = string | number | boolean | null;
export type LearningsValue = LearningsScalar | LearningsScalar[];

export interface LearningsFrontmatter {
  [key: string]: LearningsValue | undefined;
}

export interface ParsedFrontmatterDocument {
  frontmatter: LearningsFrontmatter;
  body: string;
}

export interface LearningsSearchOptions {
  limit?: number;
}

export interface LearningsQueryEvidence {
  id: string;
  url?: string;
  sourceType: string;
  title?: string;
  content: string;
  finalWeight?: number;
}

export interface LearningsQueryResult {
  id: string;
  repositoryId: string;
  title?: string;
  kind: string;
  statement: string;
  rationale?: string;
  applicability?: string;
  confidence?: number;
  status: string;
  tags: string[];
  evidence: LearningsQueryEvidence[];
}
