import { v4 as uuidv4 } from 'uuid';
import type {
  ChatSession,
  ChatSessionOptions,
  DomainMessage,
  ChatSessionStore as ChatSessionStore,
  ConversationOptions,
} from './types';
import { ClaudeConversationManager } from './claude-code/claude-conversation-manager';
import { MessageProcessor } from './claude-code/message-processor';
import { FileChatSessionStore } from './session-store';
import type { SDKMessage } from '@anthropic-ai/claude-code';

export interface Context {
  systemPrompt?: string;
  [key: string]: any;
}

export class ChatSessionManager {
  private sessionStore: ChatSessionStore;
  private messageProcessor: MessageProcessor;

  constructor(
    private conversationManager: ClaudeConversationManager,
    sessionStore?: ChatSessionStore,
  ) {
    this.sessionStore = sessionStore || new FileChatSessionStore();
    this.messageProcessor = new MessageProcessor();
  }

  async startSession(options: ChatSessionOptions = {}): Promise<ChatSession> {
    const session: ChatSession = {
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
      title: options.title,
      claudeSessionIds: [],
      messageHistory: [],
      metadata: {
        projectPath: options.projectPath,
        ...options.metadata,
      },
      status: 'active',
    };

    await this.sessionStore.save(session);
    return session;
  }

  async *chat(sessionId: string, prompt: string, context: Context = {}): AsyncGenerator<DomainMessage> {
    // Load the session
    const session = await this.sessionStore.load(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Prepare the full prompt with context
    let fullPrompt = prompt;
    if (context.systemPrompt) {
      fullPrompt = `${context.systemPrompt}\n\n${prompt}`;
    }

    // Start the conversation
    const conversationOptions: ConversationOptions = {
      scepterSessionId: session.id,
      maxTurns: 20,
    };

    const conversation = this.conversationManager.converse(fullPrompt, conversationOptions);

    // Process messages
    for await (const processed of conversation) {
      // Add to session history
      session.messageHistory.push(processed.original);

      // Track Claude session IDs
      if (
        processed.original.type === 'system' &&
        processed.original.subtype === 'init' &&
        !session.claudeSessionIds.includes(processed.original.session_id)
      ) {
        session.claudeSessionIds.push(processed.original.session_id);
      }

      // Convert to domain message
      const domainMessage = this.messageProcessor.toDomainMessage(processed);

      if (domainMessage) {
        // Add yield reason if present
        if (processed.yieldReason) {
          domainMessage.yieldReason = processed.yieldReason;
          session.status = 'yielded';
        }

        yield domainMessage;
      }

      // Update session
      session.updatedAt = new Date();
      await this.sessionStore.save(session);
    }

    // Mark session as completed if not yielded
    if (session.status === 'active') {
      session.status = 'completed';
      await this.sessionStore.save(session);
    }
  }

  async *continueSession(sessionId: string, prompt: string, context: Context = {}): AsyncGenerator<DomainMessage> {
    // Load the session
    const session = await this.sessionStore.load(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'yielded') {
      throw new Error(`Session ${sessionId} is not in a yielded state`);
    }

    // Reset status
    session.status = 'active';

    // Continue the conversation
    yield* this.chat(sessionId, prompt, context);
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    return this.sessionStore.load(sessionId);
  }

  async listSessions(): Promise<ChatSession[]> {
    return this.sessionStore.list();
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionStore.delete(sessionId);
  }
}
