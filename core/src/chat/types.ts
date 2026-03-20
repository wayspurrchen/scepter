import type { SDKMessage } from '@anthropic-ai/claude-code';

/**
 * Higher-level abstraction of a chat session, ostensibly to support
 * different chat agents/CLIs, but hardcoded to Claude for now
 */
export interface ChatSession {
  id: string; // Stable UUID for the entire conversation
  createdAt: Date;
  updatedAt: Date;
  title?: string;
  claudeSessionIds: string[]; // Array of Claude Code session IDs used
  messageHistory: SDKMessage[]; // All messages across all Claude interactions
  metadata: Record<string, any>; // User info, project context, etc.
  status: 'active' | 'yielded' | 'completed' | 'error';
}

// Yield related types
export interface YieldReason {
  type: 'pattern_match' | 'token_limit' | 'task_complete' | 'user_interrupt' | 'error';
  message?: string;
  data?: any;
}

export interface YieldContext {
  messageCount: number;
  tokenCount: number;
  elapsedTime: number;
  sessionId: string;
}

// Message types
export interface ProcessedMessage {
  original: SDKMessage;
  content?: string;
  isReplay: boolean;
  yieldReason?: YieldReason;
  timestamp: Date;
}

export interface DomainMessage {
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
  content: string;
  metadata?: Record<string, any>;
  yieldReason?: YieldReason;
}

// Options
export interface ConversationOptions {
  maxTurns?: number;
  scepterSessionId: string;
  model?: string;
  abortController?: AbortController;
}

export interface ChatSessionOptions {
  title?: string;
  projectPath?: string;
  metadata?: Record<string, any>;
}

// Storage interface
export interface ChatSessionStore {
  save(session: ChatSession): Promise<void>;
  load(sessionId: string): Promise<ChatSession | null>;
  list(): Promise<ChatSession[]>;
  delete(sessionId: string): Promise<void>;
}

// Yield detection
export interface ChatYieldCondition {
  name: string;
  evaluate(message: SDKMessage, context: YieldContext): YieldReason | null;
}
