import {
  query,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKUserMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
} from '@anthropic-ai/claude-code';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

// Create a timestamped log file
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const logFile = join(process.cwd(), `claude-interactive-yield-${timestamp}.md`);

// Initialize the log file
function initLog() {
  writeFileSync(logFile, `# Claude Interactive Yield Session\n\n**Started**: ${new Date().toISOString()}\n\n---\n\n`);
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
  }

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

// Get user input with a prompt
async function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Main interactive yield example
async function interactiveYieldDemo() {
  initLog();
  logSection('Interactive Yield Demo', 'Simple demonstration of yield/resume pattern');

  const controller = new AbortController();
  const messages: SDKMessage[] = [];
  let sessionId: string | undefined;
  let yieldedForInput = false;

  // Simple, direct prompt
  const initialPrompt = `Do these two things:
1. List the contents of the current directory using the ls tool
2. After showing the directory listing, say exactly "YIELD_FOR_INPUT: Which file should I analyze?"
3. Write out "hello" to "hello.md".`;

  console.log('\n🚀 Starting interactive file analysis session...\n');

  const response = query({
    prompt: initialPrompt,
    abortController: controller,
    options: { maxTurns: 10 },
  });

  // Phase 1: Initial conversation
  let done = false;
  while (!done) {
    const { value: message, done: iteratorDone } = await response.next();

    if (iteratorDone) {
      done = true;
      break;
    }

    messages.push(message);
    logMessage('Phase 1: Initial Analysis', message);

    // Capture session ID for resumption
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id;
      appendFileSync(logFile, `\n> **Session ID captured for resumption**: ${sessionId}\n`);
    }

    // Check for yield pattern
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.includes('YIELD_FOR_INPUT:')) {
          yieldedForInput = true;
          console.log('\n🛑 AI is yielding for user input...\n');

          // Extract the question from the yield message
          const yieldMatch = block.text.match(/YIELD_FOR_INPUT: (.+?)(?:\n|$)/);
          const aiQuestion = yieldMatch ? yieldMatch[1] : 'Please provide your input:';

          appendFileSync(logFile, `\n> **AI yielded with question**: ${aiQuestion}\n`);

          // Use return() to cleanly exit the generator
          // await response.return({ messages });
          done = true;
          break;
        }
      }
    }
  }

  // Check if we yielded and need to handle user input
  if (yieldedForInput && sessionId) {
    console.log('\n✅ Successfully yielded. Now gathering user input...\n');
    
    // Save messages at yield point
    const messagesAtYield = join(process.cwd(), `claude-messages-at-yield-${timestamp}.json`);
    writeFileSync(messagesAtYield, JSON.stringify(messages, null, 2));
    console.log(`💾 Saved messages at yield point to: ${messagesAtYield}`);

    // Get user's response to the AI's question
    const userResponse = await getUserInput('\n📁 Which file would you like analyzed? ');

    appendFileSync(logFile, `\n> **User provided input**: ${userResponse}\n`);
    console.log(`\n📥 User input received: "${userResponse}"`);

    // Phase 2: Resume with user input
    console.log('\n🔄 Resuming conversation with your input...\n');
    logSection('Phase 2: Resumed with User Input', 'Continuing the architecture design with user feedback');

    const resumeController = new AbortController();
    const resumePrompt = `The user selected: "${userResponse}"

Now analyze that file and provide a summary of its contents and purpose.`;

    try {
      for await (const message of query({
        prompt: resumePrompt,
        abortController: resumeController,
        options: {
          maxTurns: 10,
          resume: sessionId, // Resume the previous session
        },
      })) {
        messages.push(message);
        logMessage('Phase 2: Resumed', message);
      }

      console.log('\n✅ Interactive session completed successfully!');
      appendFileSync(logFile, '\n---\n\n## Session Complete\n\n**Status**: Success\n');
      
      // Save all messages after resume
      const messagesAfterYield = join(process.cwd(), `claude-messages-after-yield-${timestamp}.json`);
      writeFileSync(messagesAfterYield, JSON.stringify(messages, null, 2));
      console.log(`💾 Saved all messages after resume to: ${messagesAfterYield}`);

      // Summary
      const assistantMessages = messages.filter((m) => m.type === 'assistant').length;
      const toolUses = messages.filter(
        (m) => m.type === 'assistant' && m.message.content.some((c) => c.type === 'tool_use'),
      ).length;

      console.log('\n📊 Session Summary:');
      console.log(`- Total messages: ${messages.length}`);
      console.log(`- Assistant messages: ${assistantMessages}`);
      console.log(`- Tool uses: ${toolUses}`);
      console.log(`- Successfully yielded and resumed: Yes`);
      console.log(`- Log file: ${logFile}`);
      console.log(`- Messages at yield: ${messagesAtYield}`);
      console.log(`- Messages after yield: ${messagesAfterYield}`);
    } catch (resumeError) {
      console.error('\n❌ Error during resume:', resumeError);
      appendFileSync(logFile, `\n> **Error during resume**: ${resumeError}\n`);
    }
  }

  if (!yieldedForInput) {
    console.log('\n⚠️ Warning: AI did not yield for input as expected');
    appendFileSync(logFile, '\n> **⚠️ Warning: AI did not yield for user input**\n');

    // Still show summary
    console.log('\n📊 Session Summary:');
    console.log(`- Total messages: ${messages.length}`);
    console.log(`- Session completed without yielding`);
    console.log(`- Log file: ${logFile}`);
  }
}

// Main execution
async function main() {
  console.log('🤖 Claude Interactive Yield Demo\n');

  await interactiveYieldDemo();
}

// Run the demo
main().catch(console.error);
