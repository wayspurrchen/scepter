// Convenience factory function
import { ChatSessionManager } from './session-manager';
import { ClaudeConversationManager } from './claude-code/claude-conversation-manager';
import { FileChatSessionStore } from './session-store';
import { ChatOrchestrator } from './chat-orchestrator';
import type { ConfigManager } from '../config/config-manager';
import type { ContextGatherer } from '../context/context-gatherer';

export interface ChatSystemDependencies {
  configManager: ConfigManager;
  contextGatherer: ContextGatherer;
}

export function createChatSystem(
  dependencies: ChatSystemDependencies,
  options: {
    yieldPatterns?: RegExp[];
    sessionStorePath?: string;
  } = {},
) {
  // Create conversation manager with patterns
  const conversationManager = new ClaudeConversationManager();
  if (options.yieldPatterns) {
    options.yieldPatterns.forEach((pattern) => {
      conversationManager.addYieldPattern(pattern);
    });
  }

  // Create session store
  const sessionStore = new FileChatSessionStore(options.sessionStorePath);

  // Create session manager
  const sessionManager = new ChatSessionManager(conversationManager, sessionStore);

  // Create unified orchestrator
  const orchestrator = new ChatOrchestrator(
    sessionManager,
    dependencies.configManager,
    dependencies.contextGatherer,
  );

  return {
    sessionManager,
    orchestrator,
    conversationManager,
    sessionStore,
  };
}
