/**
 * Chat orchestration entry points for different interaction patterns
 */

import { ChatOrchestrator } from './chat-orchestrator';
import { ChatSessionManager } from './session-manager';
import type { Task } from '../types/task';
import type { DomainMessage } from './types';

export interface ChatOrchestrationDeps {
  sessionManager: ChatSessionManager;
  orchestrator: ChatOrchestrator;
}

/**
 * Entry point for UI/API to execute a task autonomously
 */
export async function executeTaskWithChat(
  config: ChatOrchestrationDeps,
  task: Task,
  onYield?: (reason: any) => Promise<string>,
): Promise<void> {
  const { sessionManager, orchestrator } = config;

  // Start task-based chat session
  const { session, systemPrompt } = await orchestrator.startChat({
    mode: 'task',
    task,
  });

  console.log(`Starting autonomous task execution: ${task.title}`);

  // Execute task with occasional yields
  for await (const message of sessionManager.chat(session.id, task.description, { systemPrompt })) {
    // Log progress (in real app, might update UI)
    if (message.type === 'assistant') {
      console.log(`[Task ${task.id}] ${message.content}`);
    }

    // Handle yields for blockers
    if (message.yieldReason) {
      console.log(`[Task ${task.id}] Yielded: ${message.yieldReason.message}`);

      if (onYield) {
        // Get resolution from handler (UI, API, etc.)
        const resolution = await onYield(message.yieldReason);

        // Resume with resolution
        const resumePrompt = await orchestrator.updateSession(session.id, {
          type: 'resume',
          content: resolution,
        });

        // Continue execution
        for await (const resumeMsg of sessionManager.continueSession(session.id, resumePrompt)) {
          if (resumeMsg.type === 'assistant') {
            console.log(`[Task ${task.id}] ${resumeMsg.content}`);
          }
        }
      } else {
        // No handler, task remains yielded
        break;
      }
    }
  }

  console.log(`Task ${task.id} execution completed`);
}

/**
 * Entry point for UI/API to start an interactive chat
 */
export async function startInteractiveChat(
  config: ChatOrchestrationDeps,
  options: {
    mode?: string;
    initialPrompt: string;
    onMessage: (message: DomainMessage) => void;
    onYield?: () => Promise<string>;
    projectPath?: string;
    contextHints?: any;
  },
): Promise<{ sessionId: string; continue: (input: string) => AsyncGenerator<DomainMessage> }> {
  const { sessionManager, orchestrator } = config;

  // Start interactive session
  const { session, systemPrompt } = await orchestrator.startChat({
    mode: 'interactive',
    initialPrompt: options.initialPrompt,
    contextHints: options.contextHints,
    projectPath: options.projectPath,
  });

  // Process initial exchange
  for await (const message of sessionManager.chat(session.id, options.initialPrompt, { systemPrompt })) {
    options.onMessage(message);

    // Interactive chats naturally yield after each response
    if (message.type === 'assistant' && !message.yieldReason) {
      // Add implicit yield for interactive mode
      message.yieldReason = {
        type: 'pattern_match',
        message: 'Awaiting user input',
      };
    }

    if (message.yieldReason) {
      break; // Always yield back to user
    }
  }

  // Return continuation function for subsequent interactions
  return {
    sessionId: session.id,
    continue: async function* (userInput: string) {
      for await (const message of sessionManager.continueSession(session.id, userInput)) {
        yield message;

        // Again, yield after assistant response
        if (message.type === 'assistant' && !message.yieldReason) {
          message.yieldReason = {
            type: 'pattern_match',
            message: 'Awaiting user input',
          };
          break;
        }
      }
    },
  };
}

/**
 * Example: Task execution with yield handling
 */
export async function exampleTaskExecution(config: ChatOrchestrationDeps) {
  const mockTask: Task = {
    id: 'T001',
    title: 'Define authentication requirements',
    description: 'Create comprehensive requirements for user authentication system',
    status: 'queued' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    gatheredNotes: [],
  };

  await executeTaskWithChat(config, mockTask, async (yieldReason) => {
    console.log('Task needs human input:', yieldReason);
    // In real app: show UI, wait for user, return resolution
    return 'Use JWT tokens with refresh token rotation';
  });
}

/**
 * Example: Interactive chat session
 */
export async function exampleInteractiveChat(config: ChatOrchestrationDeps) {
  const chat = await startInteractiveChat(config, {
    mode: 'architecture',
    initialPrompt: 'Help me design a microservices architecture',
    onMessage: (msg) => {
      if (msg.type === 'assistant') {
        console.log('Assistant:', msg.content);
      }
    },
  });

  // Simulate user conversation
  const userInputs = [
    'What are the key considerations?',
    'How should I handle authentication?',
    'Create a decision note about using API Gateway',
  ];

  for (const input of userInputs) {
    console.log('User:', input);

    for await (const message of chat.continue(input)) {
      if (message.type === 'assistant') {
        console.log('Assistant:', message.content);
      }

      if (message.yieldReason) {
        break; // Ready for next input
      }
    }
  }
}
