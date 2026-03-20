import type { Task } from '../types/task';
import type { ConfigManager } from '../config/config-manager';
import type { ContextGatherer } from '../context/context-gatherer';
import { ChatSessionManager } from './session-manager';
import type { ChatSession } from './types';
import type { ContextHints } from '../types/context';

export type ChatMode = 'task' | 'interactive';

export interface ChatOrchestrationOptions {
  mode: ChatMode;
  title?: string;
  projectPath?: string;
  metadata?: Record<string, any>;
}

export interface TaskChatOptions extends ChatOrchestrationOptions {
  mode: 'task';
  task: Task;
}

export interface InteractiveChatOptions extends ChatOrchestrationOptions {
  mode: 'interactive';
  initialPrompt: string;
  contextHints?: ContextHints;
}

export type ChatOptions = TaskChatOptions | InteractiveChatOptions;

export interface ChatResult {
  session: ChatSession;
  systemPrompt: string;
  contextSummary: {
    noteCount: number;
    tags: string[];
  };
}

/**
 * Orchestrator for chat sessions, which should work with both
 * task-based and interactive chat sessions.
 */
export class ChatOrchestrator {
  constructor(
    private sessionManager: ChatSessionManager,
    private configManager: ConfigManager,
    private contextGatherer: ContextGatherer,
  ) {}

  /**
   * Start a chat session (task or interactive)
   */
  async startChat(options: ChatOptions): Promise<ChatResult> {
    // 1. Gather context
    const context = await this.gatherContext(options);

    // 2. Create session
    const session = await this.createSession(options, context);

    // 3. Build system prompt
    const systemPrompt = this.buildSystemPrompt(options, context);

    return {
      session,
      systemPrompt,
      contextSummary: {
        noteCount: context.noteCount,
        tags: context.tags,
      },
    };
  }

  /**
   * Gather context based on chat mode
   */
  private async gatherContext(
    options: ChatOptions,
  ): Promise<{
    notes: any[];
    noteCount: number;
    tags: string[];
  }> {
    if (options.mode === 'task') {
      // Task mode: use pre-gathered notes
      const gatheredNotes = options.task.gatheredNotes || [];
      const tags = new Set<string>();
      gatheredNotes.forEach((gn) => gn.note.tags.forEach((cat) => tags.add(cat)));

      return {
        notes: gatheredNotes,
        noteCount: gatheredNotes.length,
        tags: Array.from(tags),
      };
    } else {
      // Interactive mode: gather dynamically
      const hints = options.contextHints || {};
      const gathered = await this.contextGatherer.gatherContext(hints);

      return {
        notes: [...gathered.contextHintNotes, ...gathered.referencedNotes],
        noteCount: gathered.contextHintNotes.length + gathered.referencedNotes.length,
        tags: gathered.stats.tagsMatched,
      };
    }
  }

  /**
   * Create session with appropriate metadata
   */
  private async createSession(
    options: ChatOptions,
    context: any,
  ): Promise<ChatSession> {
    const baseMetadata = {
      chatMode: options.mode,
      ...options.metadata,
    };

    if (options.mode === 'task') {
      return await this.sessionManager.startSession({
        title: `Task ${options.task.id}: ${options.task.title}`,
        metadata: {
          ...baseMetadata,
          taskId: options.task.id,
          contextNoteIds: options.task.gatheredNotes?.map((gn) => gn.note.id) || [],
          isTaskSession: true,
        },
      });
    } else {
      return await this.sessionManager.startSession({
        title: options.title || `Chat: ${options.initialPrompt.slice(0, 50)}...`,
        projectPath: options.projectPath,
        metadata: {
          ...baseMetadata,
          isInteractive: true,
          contextStats: context,
        },
      });
    }
  }

  /**
   * Build system prompt based on chat mode
   */
  private buildSystemPrompt(
    options: ChatOptions,
    context: any,
  ): string {
    const sections: string[] = [];

    // Mode-specific instructions
    if (options.mode === 'task') {
      sections.push(this.buildTaskInstructions(options.task));
    } else {
      sections.push(this.buildInteractiveInstructions());
    }

    // Context notes
    if (context.notes.length > 0) {
      sections.push(this.buildContextSection(options.mode, context.notes));
    }

    return sections.join('\n\n');
  }

  private buildTaskInstructions(task: Task): string {
    return `## Task Execution Mode
You are executing a task autonomously.

Task: ${task.title}
Description: ${task.description}

Guidelines:
1. Work autonomously to complete the task
2. Create notes as needed to document your work
3. Reference existing notes when applicable
4. Only yield if you encounter a blocker that requires human decision
5. When yielding, use the pattern: "YIELD: [reason for yielding]"
6. Continue working after blockers are resolved`;
  }

  private buildInteractiveInstructions(): string {
    return `## Interactive Chat Session
You are in an interactive conversation with the user. Be helpful, concise, and responsive.

Key guidelines:
1. Answer the user's questions directly
2. Ask for clarification when needed
3. Reference relevant notes from the project context
4. Create new notes when documenting decisions or important information
5. Keep responses focused and avoid unnecessary elaboration`;
  }

  private buildContextSection(mode: ChatMode, notes: any[]): string {
    if (mode === 'task') {
      return `## Relevant Notes
${notes
  .map((gn) => {
    const note = gn.note;
    return `### ${note.id}: ${note.title}
- Type: ${note.type}
- Tags: ${note.tags.join(', ')}
- Matched by: ${gn.matchedBy}

${note.content}`;
  })
  .join('\n\n')}`;
    } else {
      // Interactive mode: summarize available context
      const topNotes = notes.slice(0, 5);
      let section = `## Available Context
Found ${notes.length} relevant notes

Key notes:
${topNotes.map((note) => `- ${note.id}: ${note.title} (${note.type})`).join('\n')}`;

      if (notes.length > 5) {
        section += `\n... and ${notes.length - 5} more notes available`;
      }

      return section;
    }
  }

  /**
   * Resume or update a chat session
   */
  async updateSession(
    sessionId: string,
    update: {
      type: 'resume' | 'context_update';
      content: string;
    },
  ): Promise<string> {
    if (update.type === 'resume') {
      return this.buildResumePrompt(update.content);
    } else {
      return this.buildContextUpdatePrompt(update.content);
    }
  }

  private buildResumePrompt(resolution: string): string {
    return `The blocker has been resolved with the following information:\n\n${resolution}\n\nPlease continue with the task execution.`;
  }

  private buildContextUpdatePrompt(content: string): string {
    return `## Updated Context\n\n${content}\n\nPlease consider this additional context in your responses.`;
  }
}
