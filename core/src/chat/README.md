# Chat System Documentation

## Overview

The chat system in SCEpter provides a unified interface for both autonomous task execution and interactive conversations with an LLM. It handles context gathering, session management, and yield/resume patterns.

## Key Concepts

### Chat Modes

1. **Task Mode**: Autonomous execution with occasional yields for blockers
2. **Interactive Mode**: Natural conversation flow with yields after each exchange

### Context Gathering

Context is gathered from multiple sources and merged intelligently:

- **Task-Specific Hints**: Additional patterns for the specific task
- **Note References**: Explicit references found in note content
- **Dynamic Gathering**: For interactive sessions based on conversation

See [CONTEXT_DATA_FLOW.md](./CONTEXT_DATA_FLOW.md) for detailed information about how context flows through the system.

### Session Management

- Sessions persist across Claude Code restarts
- Handles message deduplication (Claude SDK replays messages)
- Tracks yield states and allows resumption
- Stores complete message history

## Architecture

### Core Components

1. **ChatOrchestrator**: Coordinates chat sessions, manages context gathering, builds system prompts
2. **ChatSessionManager**: Manages session lifecycle, message flow, yield detection
3. **ClaudeConversationManager**: Interfaces with Claude Code SDK, detects yield patterns
4. **MessageProcessor**: Handles message deduplication and transformation
5. **SessionStore**: Persists sessions to filesystem

### Design Decisions

See [CHAT_SYSTEM_DESIGN.md](./CHAT_SYSTEM_DESIGN.md) for architectural decisions and rationale.

## Usage

### Task Execution

```typescript
const config = {
  sessionManager,
  orchestrator
};

const task = {
  id: 'T001',
  title: 'Define auth requirements',
  description: 'Create comprehensive authentication requirements',
  contextHints: {
    patterns: ['auth', 'security'],
    includeCategories: ['authentication']
  }
};

await executeTaskWithChat(config, task, async (yieldReason) => {
  // Handle yield - get user input
  return userResponse;
});
```

### Interactive Chat

```typescript
const chat = await startInteractiveChat(config, {
  initialPrompt: 'Help design the authentication system',
  onMessage: (msg) => console.log(msg.content)
});

// Continue conversation
for await (const message of chat.continue('What about JWT?')) {
  console.log(message.content);
  if (message.yieldReason) break;
}
```

## Context Layers

The system implements a layered approach to context gathering:

1. **Automatic Hints**: From tasks and notes
2. **Explicit References**: Direct note references in content

See [CONTEXT_LAYERS_SUMMARY.md](./CONTEXT_LAYERS_SUMMARY.md) for implementation status and details.

## Yield/Resume Pattern

The system supports yielding execution when:
- Human decision needed
- Clarification required
- Explicit yield pattern detected

Yields are handled by:
1. Detecting yield patterns in LLM responses
2. Saving session state
3. Returning control to caller
4. Resuming with user input

## Configuration

Configure the chat system through:

- **Yield Patterns**: Custom patterns for yield detection
- **Session Storage**: Path for session persistence

## Future Enhancements

- Smart reference inclusion
- Context hint extraction from LLM output
- Task persistence and resumption
- Fragment preview for selective inclusion