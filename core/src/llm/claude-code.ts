import {
  query,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKUserMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
} from '@anthropic-ai/claude-code';
import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

// Create a timestamped log file
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const logFile = join(process.cwd(), `claude-session-${timestamp}.md`);

// Initialize the log file
function initLog() {
  writeFileSync(logFile, `# Claude Code Session Log\n\n**Started**: ${new Date().toISOString()}\n\n---\n\n`);
  console.log(`Logging to: ${logFile}`);
}

// Append a message to the log
function logMessage(section: string, message: SDKMessage, note?: string) {
  const timestamp = new Date().toISOString();
  let content = `\n### [${timestamp}] ${message.type.toUpperCase()} Message\n\n`;

  if (note) {
    content += `> **Note**: ${note}\n\n`;
  }

  if (message.type === 'system' && message.subtype === 'init') {
    content += `- **Session ID**: ${message.session_id}\n`;
    content += `- **Model**: ${message.model}\n`;
    content += `- **Tools**: ${message.tools.join(', ')}\n`;
    content += `- **Permission Mode**: ${message.permissionMode}\n`;
  } else if (message.type === 'user') {
    content += `**User**: ${JSON.stringify(message.message.content, null, 2)}\n`;
  } else if (message.type === 'assistant') {
    content += `**Assistant**:\n\n`;
    // Assistant messages always have content array in Claude Code SDK
    const contentArray = message.message.content;
    for (const item of contentArray) {
      if (item.type === 'text') {
        content += `${item.text}\n\n`;
      } else if (item.type === 'tool_use') {
        content += `🔧 **Tool Use**: ${item.name}\n`;
        content += `\`\`\`json\n${JSON.stringify(item.input, null, 2)}\n\`\`\`\n\n`;
      }
    }
  } else if (message.type === 'result') {
    content += `- **Status**: ${message.subtype}\n`;
    content += `- **Duration**: ${message.duration_ms}ms\n`;
    content += `- **Tokens Used**: ${message.usage.input_tokens + message.usage.output_tokens}\n`;
    content += `- **Cost**: $${message.total_cost_usd.toFixed(4)}\n`;
    if (message.subtype === 'success' && message.result) {
      content += `- **Result**: ${message.result}\n`;
    }
  }

  // Append the full JSON message content, stringified, to the log
  content += `\n<details>\n<summary>Raw JSON Message</summary>\n\n`;
  content += '```json\n' + JSON.stringify(message, null, 2) + '\n```\n';
  content += '</details>\n';

  appendFileSync(logFile, content);
}

// Add section header to log
function logSection(title: string, description?: string) {
  let content = `\n## ${title}\n\n`;
  if (description) {
    content += `${description}\n\n`;
  }
  appendFileSync(logFile, content);
}

// Basic example - your current code
async function basicExample() {
  logSection('Basic Example', 'Simple query asking about available tools');
  const messages: SDKMessage[] = [];

  for await (const message of query({
    prompt: 'What tools do you have access to?',
    abortController: new AbortController(),
    options: {
      model: 'sonnet',
      maxTurns: 3,
      executable: 'node',
      cwd: process.cwd(),
    },
  })) {
    messages.push(message);
    logMessage('Basic Example', message);
  }

  console.log('Basic example completed');
}

// Example 1: Abort on specific conditions
async function abortOnCondition() {
  logSection('Abort on Condition', 'Demonstrates aborting when too many tool uses are detected');
  const controller = new AbortController();
  const messages: SDKMessage[] = [];
  let totalToolUses = 0;

  try {
    for await (const message of query({
      prompt:
        'Please analyze all TypeScript files in the src folder and find any files that import from parent directories (../..). Use grep to search for these patterns.',
      abortController: controller,
      options: { maxTurns: 10 },
    })) {
      messages.push(message);
      logMessage('Abort on Condition', message);

      // Count tool uses across all messages
      if (message.type === 'assistant') {
        // Check if this message contains any tool_use blocks
        const hasToolUse = message.message.content.some((c) => c.type === 'tool_use');
        if (hasToolUse) {
          totalToolUses++;
          console.log(`Tool use detected. Total tool uses: ${totalToolUses}`);

          if (totalToolUses > 3) {
            logMessage('Abort on Condition', message, `Aborting - too many tool uses (${totalToolUses} total)`);
            console.log(`Aborting - too many tool uses (${totalToolUses} total)`);
            controller.abort();
          }
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      appendFileSync(logFile, `\n> **Aborted Successfully** - Total tool uses: ${totalToolUses}\n`);
      console.log('Successfully aborted');
      return { messages, aborted: true, toolUses: totalToolUses };
    }
    throw error;
  }

  return { messages, aborted: false, toolUses: totalToolUses };
}

// Example 2: Time-based abort
async function abortAfterTimeout(timeoutMs: number = 10000) {
  logSection('Time-based Abort', `Demonstrates aborting after ${timeoutMs}ms timeout`);
  const controller = new AbortController();
  const messages: SDKMessage[] = [];

  // // Set up timeout
  // const timeoutId = setTimeout(() => {
  //   appendFileSync(logFile, `\n> **Timeout reached (${timeoutMs}ms) - aborting...**\n`);
  //   console.log(`Aborting after ${timeoutMs}ms`);
  //   controller.abort();
  // }, timeoutMs);

  try {
    for await (const message of query({
      prompt: 'List 3 simple tasks that would help improve code quality',
      abortController: controller,
      options: { maxTurns: 5 },
    })) {
      messages.push(message);
      controller.abort('please stop');
      logMessage('Time-based Abort', message);
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      appendFileSync(logFile, '\n> **Timed out - returning partial results**\n');
      console.log('Timed out - returning partial results');
    }
  }

  return messages;
}

// Example 3: Interactive session with pause/resume
class InteractiveSession {
  private controller?: AbortController;
  private messages: SDKMessage[] = [];
  private sessionId?: string;
  private isPaused = false;
  private messageCount = 0;

  async start(initialPrompt: string, sectionName: string = 'Interactive Session') {
    this.controller = new AbortController();

    try {
      for await (const message of query({
        prompt: initialPrompt,
        abortController: this.controller,
        options: {
          maxTurns: 100,
          resume: this.sessionId,
        },
      })) {
        this.messages.push(message);
        this.messageCount++;
        logMessage(sectionName, message);

        // Extract session ID for resumption
        if (message.type === 'system' && message.subtype === 'init') {
          this.sessionId = message.session_id;
          appendFileSync(logFile, `\n> **Session ID captured**: ${this.sessionId}\n`);
        }

        // Process message
        await this.processMessage(message);

        // Simulate pause after 3 messages for demo
        if (this.messageCount === 3 && sectionName === 'Interactive Session') {
          this.pause();
        }

        // Check if we should pause
        if (this.isPaused) {
          this.controller.abort();
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError' && this.isPaused) {
        appendFileSync(logFile, '\n> **Session paused - can be resumed later**\n');
        console.log('Session paused - can be resumed later');
        return { paused: true, sessionId: this.sessionId };
      }
      throw error;
    }
  }

  async resume(newPrompt: string) {
    if (!this.sessionId) {
      throw new Error('No session to resume');
    }

    appendFileSync(logFile, '\n> **Resuming session...**\n');
    this.isPaused = false;
    this.controller = new AbortController();

    return this.start(newPrompt, 'Interactive Session (Resumed)');
  }

  pause() {
    this.isPaused = true;
    appendFileSync(logFile, '\n> **Pause requested**\n');
    // Will abort on next message
  }

  private async processMessage(message: SDKMessage) {
    // Could emit events, update UI, check conditions, etc.
    console.log(`Processing ${message.type} message`);
  }
}

// Example 4: Intelligent context-aware abort
class ContextAwareController {
  private controller = new AbortController();
  private tokenCount = 0;
  private taskQueue: string[] = [];
  private toolUseCount = 0;

  async executeWithContextManagement(prompt: string, maxTokens: number = 50000) {
    const messages: SDKMessage[] = [];

    for await (const message of query({
      prompt,
      abortController: this.controller,
      options: { maxTurns: 20 },
    })) {
      messages.push(message);
      logMessage('Context-Aware', message);

      // Track token usage from result messages
      if (message.type === 'result') {
        this.tokenCount += message.usage.input_tokens + message.usage.output_tokens;
      }

      // Track token usage from assistant messages (in Claude Code SDK)
      if (message.type === 'assistant' && message.message.usage) {
        this.tokenCount += message.message.usage.input_tokens + message.message.usage.output_tokens;
      }

      // Abort if approaching token limit
      if (this.tokenCount > maxTokens * 0.9) {
        console.log('Approaching token limit - saving state and aborting');
        this.saveState(messages);
        this.controller.abort();
      }

      // Count tool uses and extract tasks from assistant messages
      if (message.type === 'assistant') {
        // Count tool uses
        const hasToolUse = message.message.content.some((c) => c.type === 'tool_use');
        if (hasToolUse) {
          this.toolUseCount++;
        }

        // Extract tasks
        const tasks = this.extractTasks(message);
        this.taskQueue.push(...tasks);

        // Abort if we have enough tasks to process
        if (this.taskQueue.length >= 5) {
          console.log('Task queue full - pausing to process');
          this.controller.abort();
        }
      }
    }

    return {
      messages,
      tasks: this.taskQueue,
      tokenCount: this.tokenCount,
      toolUses: this.toolUseCount,
    };
  }

  private extractTasks(message: SDKAssistantMessage): string[] {
    // Extract TODO items or task-like content from assistant messages
    const tasks: string[] = [];
    const content = message.message.content;

    // Look through all content blocks for text containing TODOs
    for (const block of content) {
      if (block.type === 'text') {
        const todoMatches = block.text.match(/TODO:(.+)/g) || [];
        tasks.push(...todoMatches);
      }
    }

    return tasks;
  }

  private saveState(messages: SDKMessage[]) {
    // Could save to database, file, etc.
    console.log(`Saving ${messages.length} messages for later resumption`);
  }
}

// Example 5: Instructed abort pattern
async function instructedAbortExample() {
  logSection('Instructed Abort Pattern', 'Instructs LLM to emit specific string for abort testing');
  const controller = new AbortController();
  const messages: SDKMessage[] = [];
  let abortedCorrectly = false;

  const prompt = `Please help me with a two-part task:
1. First, analyze what would be needed to implement a user authentication system. When you've listed the key components, say "NEED_HUMAN_DECISION" to indicate you need input on which approach to take.
2. After that, if you haven't been interrupted, proceed to create a simple example of a login function in a message (do not make file changes).

Remember: After listing the components, you must say "NEED_HUMAN_DECISION" before proceeding.`;

  try {
    for await (const message of query({
      prompt,
      abortController: controller,
      options: { maxTurns: 5 },
    })) {
      messages.push(message);
      logMessage('Instructed Abort', message);

      // Check for our abort pattern in text blocks
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.includes('NEED_HUMAN_DECISION')) {
            abortedCorrectly = true;
            logMessage('Instructed Abort', message, '✅ Found NEED_HUMAN_DECISION - aborting as expected');
            console.log('✅ Successfully detected NEED_HUMAN_DECISION - aborting');
            controller.abort();
            break;
          }
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError' && abortedCorrectly) {
      appendFileSync(logFile, '\n> **✅ Abort mechanism verified - interrupted at the correct point**\n');
      console.log('✅ Abort mechanism verified successfully');
      return { messages, aborted: true, success: true };
    }
    throw error;
  }

  if (!abortedCorrectly) {
    appendFileSync(logFile, '\n> **⚠️ Warning: LLM did not emit NEED_HUMAN_DECISION as instructed**\n');
    console.log('⚠️ Warning: Abort pattern was not detected');
  }

  return { messages, aborted: false };
}

// Example 6: Multi-stage conversation with abort between stages
async function multiStageConversation() {
  // Stage 1: Gather requirements
  const requirementsController = new AbortController();
  const requirementsMessages: SDKMessage[] = [];

  console.log('Stage 1: Gathering requirements...');
  for await (const message of query({
    prompt: 'Help me define requirements for a user authentication system',
    abortController: requirementsController,
    options: { maxTurns: 5 },
  })) {
    requirementsMessages.push(message);

    // Abort after getting initial requirements
    if (message.type === 'assistant') {
      const hasRequirements = message.message.content.some(
        (block) => block.type === 'text' && (block.text.includes('requirement') || block.text.includes('need')),
      );
      if (hasRequirements) {
        requirementsController.abort();
      }
    }
  }

  // Process requirements, create SCEpter notes
  const requirements = extractRequirements(requirementsMessages);

  // Stage 2: Design phase
  const designController = new AbortController();
  const designMessages: SDKMessage[] = [];

  console.log('Stage 2: Creating design...');
  const designPrompt = `Based on these requirements: ${requirements.join(', ')}, create a technical design`;

  for await (const message of query({
    prompt: designPrompt,
    abortController: designController,
    options: { maxTurns: 5 },
  })) {
    designMessages.push(message);
  }

  return {
    requirements: requirementsMessages,
    design: designMessages,
  };
}

function extractRequirements(messages: SDKMessage[]): string[] {
  // Extract requirements from messages
  return ['Requirement 1', 'Requirement 2'];
}

// Example usage with logging
async function demonstrateUsage() {
  initLog();

  try {
    // 1. Basic example
    console.log('\n=== Running Basic Example ===');
    await basicExample();

    // 2. Simple abort on condition
    console.log('\n=== Running Abort on Condition ===');
    await abortOnCondition();

    // 3. Time-based abort
    console.log('\n=== Running Time-based Abort ===');
    const timedMessages = await abortAfterTimeout(5000); // 5 second timeout for demo

    // 4. Instructed abort example
    console.log('\n=== Running Instructed Abort Example ===');
    await instructedAbortExample();

    // 5. Interactive session
    console.log('\n=== Running Interactive Session ===');
    logSection('Interactive Session', 'Demonstrates pause/resume functionality');
    const session = new InteractiveSession();
    const pauseResult = await session.start('What are the best practices for error handling in TypeScript?');

    if (pauseResult?.paused) {
      console.log('Session paused, waiting 2 seconds before resuming...');
      appendFileSync(logFile, '\n> **Waiting 2 seconds before resume...**\n');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await session.resume('Continue with more specific examples');
    }

    // 6. Context-aware controller
    console.log('\n=== Running Context-Aware Controller ===');
    logSection('Context-Aware Controller', 'Demonstrates intelligent token and task management');
    const contextController = new ContextAwareController();
    const contextResult = await contextController.executeWithContextManagement(
      'List three TODO items for improving code quality in a TypeScript project. Format each as "TODO: [description]"',
      10000, // Lower token limit for demo
    );
    console.log(
      `Context-aware execution completed: ${contextResult.tasks.length} tasks found, ${contextResult.toolUses} tool uses, ${contextResult.tokenCount} tokens used`,
    );

    // Add completion message
    appendFileSync(logFile, '\n---\n\n## Session Complete\n\n**Ended**: ' + new Date().toISOString() + '\n');
    console.log(`\n✅ All examples completed! Check the log file: ${logFile}`);
  } catch (error) {
    console.error('Error during demonstration:', error);
    appendFileSync(logFile, `\n## Error\n\n\`\`\`\n${error}\n\`\`\`\n`);
  }
}

// Run the demonstration when this file is executed directly
demonstrateUsage().catch(console.error);

// Export for use in SCEpter
export { InteractiveSession, ContextAwareController, multiStageConversation, type SDKMessage };
