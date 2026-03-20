import { EventEmitter } from 'events';
import type { Task, TaskConfig, GatheredNote } from '../types/task';
import { TaskStatus } from '../types/task';
import type { SimpleLLMFunction } from '../llm/types';
import { OpenAIModel } from '../llm/types';
import type { ContextHints } from '../types/context';
import { parseNoteMentions } from '../parsers/note/note-parser';
import type { NoteManager } from '../notes/note-manager';
import type { ContextGatherer } from '../context/context-gatherer';
import type { Note } from '../types/note';

export interface TaskDispatcherConfig {
  llmFunction?: SimpleLLMFunction;
  defaultModel?: string;
  noteManager?: NoteManager;
  contextGatherer?: ContextGatherer;
}

export interface PrepareTaskOptions {
  skipLLMAnalysis?: boolean;
  existingTags?: string[];
}

export interface CreateTaskOptions {
  skipPreparation?: boolean;
  skipContextGathering?: boolean;
  prepareOptions?: PrepareTaskOptions;
}

export interface PreparedTaskConfig extends TaskConfig {
  contextHints?: ContextHints;
  metadata?: Record<string, any>;
}

export class TaskDispatcher extends EventEmitter {
  private taskCounter = 0;
  private tasks: Map<string, Task> = new Map();
  private llmFunction?: SimpleLLMFunction;
  private defaultModel: string;
  private noteManager?: NoteManager;
  private contextGatherer?: ContextGatherer;

  constructor(config: TaskDispatcherConfig = {}) {
    super();
    this.llmFunction = config.llmFunction;
    this.defaultModel = config.defaultModel || OpenAIModel.GPT_4_1_MINI;
    this.noteManager = config.noteManager;
    this.contextGatherer = config.contextGatherer;
  }

  async createTask(config: TaskConfig, options: CreateTaskOptions = {}): Promise<Task> {
    let finalConfig = config;
    let extractedNoteIds: string[] = [];

    // 1. Prepare task if not skipped
    if (!options.skipPreparation) {
      // Get existing tags if noteManager is available
      let existingTags: string[] = [];
      if (this.noteManager && !options.prepareOptions?.existingTags) {
        const allNotes = await this.noteManager.getAllNotes();
        const tagSet = new Set<string>();
        allNotes.forEach((note) => note.tags.forEach((cat) => tagSet.add(cat.toLowerCase())));
        existingTags = Array.from(tagSet);
      }

      const prepareOptions: PrepareTaskOptions = {
        ...options.prepareOptions,
        existingTags: options.prepareOptions?.existingTags || existingTags,
      };

      const prepared = await this.prepareTask(config, prepareOptions);
      finalConfig = prepared;
      extractedNoteIds = prepared.metadata?.referencedNoteIds || [];
    }

    // 2. Create the task
    const task: Task = {
      id: `${++this.taskCounter}`,
      title: finalConfig.title,
      description: finalConfig.description || '',
      contextHints: (finalConfig as PreparedTaskConfig).contextHints,
      status: TaskStatus.QUEUED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tasks.set(task.id, task);
    this.emit('task:created', { id: task.id });

    // 3. Gather context if not skipped
    if (!options.skipContextGathering && this.contextGatherer) {
      const gatheredNotes: GatheredNote[] = [];

      // Add explicitly referenced notes
      if (extractedNoteIds.length > 0 && this.noteManager) {
        for (const noteId of extractedNoteIds) {
          const note = await this.noteManager.getNoteById(noteId);
          if (note) {
            gatheredNotes.push({
              note,
              referenceType: 'explicit-reference',
              matchedBy: 'Direct reference in task description',
            });
          }
        }
      }

      // Gather context based on hints
      if (task.contextHints) {
        const context = await this.contextGatherer.gatherForTask(task);

        // Add context hint matches
        for (const note of context.contextHintNotes) {
          // Skip if already added as explicit reference
          if (!gatheredNotes.some((gn) => gn.note.id === note.id)) {
            gatheredNotes.push({
              note,
              referenceType: 'context-hint-match',
              matchedBy: this.determineMatchReason(note, task.contextHints),
            });
          }
        }
      }

      task.gatheredNotes = gatheredNotes;
      this.emit('task:context-gathered', { id: task.id, noteCount: gatheredNotes.length });
    }

    return task;
  }

  async categorizeTask(task: Task, model?: string): Promise<string[]> {
    if (!this.llmFunction) {
      throw new Error('Cannot categorize task: LLM function not provided to TaskDispatcher');
    }

    const prompt = `Categorize this task:
Title: ${task.title}
Description: ${task.description}

Respond with a JSON array containing:
A list of specific tags and tags (e.g., "frontend", "backend", "database", "testing", "auth", "security", "performance", "scalability", "documentation", "testing", "refactoring", "maintenance", "deployment", "monitoring", "logging", "error-handling", "performance", "scalability", "documentation", "testing", "refactoring", "maintenance", "deployment", "monitoring", "logging", "error-handling", etc.)

Example:
[
  "frontend",
  "backend",
  "database",
  "testing",
  "auth",
  "security",
  "performance",
  "scalability",
  "documentation",
  "testing",
  "refactoring",
  "maintenance",
  "deployment",
  "monitoring",
  "logging",
  "error-handling"
]`;

    const response = await this.llmFunction(
      prompt,
      model || this.defaultModel,
      'You are a helpful assistant that categorizes software development tasks. Always respond with valid JSON.',
    );

    try {
      const tags = JSON.parse(response);
      // Normalize tags to lowercase
      return Array.isArray(tags) ? tags.map((cat) => cat.toLowerCase()) : ['unknown'];
    } catch (error) {
      console.error('Failed to parse categorization response:', response);
      return ['unknown'];
    }
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date();
      this.emit('task:updated', { id: taskId, status });
    }
  }

  /**
   * Prepares a task by analyzing its description and generating context hints.
   * This includes extracting referenced notes, getting mode defaults, and
   * using LLM to suggest relevant patterns and tags.
   */
  async prepareTask(config: TaskConfig, options: PrepareTaskOptions = {}): Promise<PreparedTaskConfig> {
    // 1. Extract note IDs from description using the note parser
    const mentions = parseNoteMentions(config.description || '');
    // Get all referenced note IDs (unique)
    const referencedNoteIds = [...new Set(mentions.map((m) => m.id))];

    // 2. Call LLM to analyze and suggest context hints (if not skipped)
    let suggestedHints: Partial<ContextHints> = {};
    if (!options.skipLLMAnalysis && this.llmFunction && config.description) {
      try {
        suggestedHints = await this.analyzeTaskDescription(config, options.existingTags);
      } catch (error) {
        console.error('Failed to analyze task description:', error);
        // Continue without LLM suggestions
      }
    }

    // 3. Merge into context hints
    const contextHints: ContextHints = {
      patterns: [...(suggestedHints.patterns || [])],
      includeTags: [...(suggestedHints.includeTags || [])],
      excludePatterns: [...(suggestedHints.excludePatterns || [])],
    };

    // Add referenced note IDs as a metadata field
    const metadata = {
      referencedNoteIds,
    };

    return {
      ...config,
      contextHints,
      metadata,
    };
  }

  /**
   * Uses LLM to analyze task description and suggest context hints
   */
  private async analyzeTaskDescription(config: TaskConfig, existingTags?: string[]): Promise<Partial<ContextHints>> {
    if (!this.llmFunction || !config.description) {
      return {};
    }

    const tagsSection =
      existingTags && existingTags.length > 0 ? `\nExisting tags in the project: ${existingTags.join(', ')}` : '';

    const prompt = `Analyze this task and suggest search patterns and tags for finding relevant context.

Task:
Title: ${config.title}
Description: ${config.description}
${tagsSection}

Based on this task, suggest:
1. Keywords/patterns to search for in existing notes
2. Tags that might contain relevant information
   - You should prioritize matching existing tags when relevant
   - You may also suggest new tags that are obviously missing

Respond with a JSON object containing:
{
  "patterns": ["array", "of", "search", "keywords"],
  "includeTags": ["relevant", "tags"]
}

Focus on extracting key technical terms, concepts, and domain-specific vocabulary from the task description.
When suggesting tags, prefer existing ones where appropriate but don't hesitate to suggest new ones if they would be valuable additions.`;

    try {
      const response = await this.llmFunction(
        prompt,
        this.defaultModel,
        'You are a helpful assistant that analyzes tasks to extract relevant search terms and tags. Always respond with valid JSON.',
      );

      const hints = JSON.parse(response) as { patterns: string[]; includeTags: string[] };

      // Validate the response structure and normalize tags to lowercase
      return {
        patterns: Array.isArray(hints.patterns) ? hints.patterns : [],
        includeTags: Array.isArray(hints.includeTags) ? hints.includeTags.map((cat: string) => cat.toLowerCase()) : [],
      };
    } catch (error) {
      console.error('Failed to parse LLM response for task analysis:', error);
      return {};
    }
  }

  /**
   * Determines why a note matched the context hints
   */
  private determineMatchReason(note: Note, hints: ContextHints): string {
    const reasons: string[] = [];

    // Check pattern matches
    if (hints.patterns) {
      for (const pattern of hints.patterns) {
        if (note.content.toLowerCase().includes(pattern.toLowerCase())) {
          reasons.push(`Pattern: "${pattern}"`);
          break; // Only report first pattern match
        }
      }
    }

    // Check tag matches
    if (hints.includeTags) {
      const matchedTags = note.tags.filter((cat) =>
        hints.includeTags!.some((hintCat) => cat.toLowerCase() === hintCat.toLowerCase()),
      );
      if (matchedTags.length > 0) {
        reasons.push(`Tags: ${matchedTags.join(', ')}`);
      }
    }

    return reasons.length > 0 ? reasons.join('; ') : 'Context hint match';
  }
}
