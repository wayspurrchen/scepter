import { type SDKMessage } from '@anthropic-ai/claude-code';
import type { ContextHints } from './context';
import type { Note } from './note';

// Task definition
export interface Task {
  id: string; // 0-indexed - string for future namespaces?
  title: string; // 'Create URL slug generator requirements'
  description: string; // Detailed description
  contextHints?: ContextHints; // Hints for finding relevant context
  gatheredNotes?: GatheredNote[]; // Notes gathered for context
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: TaskResult;
  metadata?: Record<string, any>;
}

export interface GatheredNote {
  note: Note;
  referenceType: 'explicit-reference' | 'context-hint-match';
  matchedBy?: string; // What pattern/tag/hint matched this note
}

export interface TaskConfig {
  title: string;
  description?: string;
  // contextRules?: ContextRule;
  // yieldOn?: YieldCondition[];
}

export enum TaskStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  YIELDED = 'yielded',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

export interface TaskOutput {
  filesCreated: string[]; // Paths to created files
  filesModified: string[]; // Paths to modified files
  notesCreated: string[]; // Note IDs created
  notesReferenced: string[]; // Note IDs referenced
  summary: string; // Human-readable summary
}

export interface TaskResult {
  status: 'complete' | 'yielded' | 'failed';
  output?: TaskOutput;
  yield?: Yield;
  error?: Error;
  notesCreated: string[];
  messages: SDKMessage[]; // Full conversation history
}

export interface ContextRule {
  includeTypes: string[];
  scopeBy?: {
    tags?: string[];
    keywords?: string[];
    referencedBy?: string[];
    pattern?: string;
  };
  includeDepth: number;
  visibilityLevel: VisibilityLevel;
  followHints: boolean;
}

export enum VisibilityLevel {
  FULL = 'full',
  NORMAL = 'normal',
  MINIMAL = 'minimal',
}

export interface Yield {
  reason: YieldReason;
  details: string;
  noteReference?: string;
  suggestions?: string[];
  canContinue: boolean;
  resumeData?: any; // Data to pass when resuming
}

export enum YieldReason {
  MISSING_DECISION = 'missing-decision',
  BLOCKING_QUESTION = 'blocking-question',
  MISSING_DEPENDENCY = 'missing-dependency',
  CLARIFICATION_NEEDED = 'clarification-needed',
  HUMAN_REVIEW = 'human-review',
}
