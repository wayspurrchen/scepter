import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import type { ConversationOptions, ProcessedMessage, YieldContext, YieldReason } from '../types';
import { MessageProcessor } from './message-processor';

export interface YieldCondition {
  name: string;
  pattern?: RegExp;
  evaluate(message: SDKMessage, context: YieldContext): YieldReason | null;
}

export class ClaudeConversationManager {
  private messageProcessor: MessageProcessor;
  private yieldConditions: YieldCondition[] = [];
  
  constructor() {
    this.messageProcessor = new MessageProcessor();
  }
  
  addYieldPattern(pattern: RegExp, message?: string): void {
    this.yieldConditions.push({
      name: `pattern-${pattern.source}`,
      pattern,
      evaluate: (msg: SDKMessage) => {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text' && pattern.test(block.text)) {
              const match = block.text.match(pattern);
              return {
                type: 'pattern_match',
                message: message || `Pattern matched: ${pattern}`,
                data: { match: match?.[0], fullText: block.text }
              };
            }
          }
        }
        return null;
      }
    });
  }
  
  addYieldCondition(condition: YieldCondition): void {
    this.yieldConditions.push(condition);
  }
  
  clearYieldConditions(): void {
    this.yieldConditions = [];
  }
  
  private checkYieldConditions(message: SDKMessage, context: YieldContext): YieldReason | null {
    for (const condition of this.yieldConditions) {
      const reason = condition.evaluate(message, context);
      if (reason) {
        return reason;
      }
    }
    return null;
  }
  
  async *converse(
    prompt: string,
    options: ConversationOptions
  ): AsyncGenerator<ProcessedMessage> {
    const startTime = Date.now();
    let messageCount = 0;
    let tokenCount = 0;
    let currentClaudeSessionId: string | undefined;
    
    // Reset message processor for new conversation
    if (!options.abortController) {
      this.messageProcessor.reset();
    }
    
    const queryOptions = {
      prompt,
      abortController: options.abortController,
      options: {
        maxTurns: options.maxTurns || 10,
        model: options.model,
        resume: undefined as string | undefined,
      }
    };
    
    // If we have a previous Claude session ID, use it for resume
    // This is passed in when continuing a yielded conversation
    if (options.abortController?.signal.aborted) {
      // This indicates a resume scenario
      queryOptions.options.resume = currentClaudeSessionId;
    }
    
    const response = query(queryOptions);
    
    // Use explicit iteration to control the flow
    let done = false;
    while (!done) {
      const { value: message, done: iteratorDone } = await response.next();
      
      if (iteratorDone || !message) {
        done = true;
        break;
      }
      
      // Track session ID for potential resume
      if (message.type === 'system' && message.subtype === 'init') {
        currentClaudeSessionId = message.session_id;
      }
      
      // Update counters
      messageCount++;
      if (message.type === 'assistant' && message.message.usage) {
        tokenCount += message.message.usage.input_tokens + message.message.usage.output_tokens;
      }
      
      // Process the message
      const processed = this.messageProcessor.processMessage(
        message,
        !!queryOptions.options.resume
      );
      
      // Skip replayed messages
      if (processed.isReplay) {
        continue;
      }
      
      // Check for yield conditions
      const yieldContext: YieldContext = {
        messageCount,
        tokenCount,
        elapsedTime: Date.now() - startTime,
        sessionId: options.scepterSessionId
      };
      
      const yieldReason = this.checkYieldConditions(message, yieldContext);
      if (yieldReason) {
        processed.yieldReason = yieldReason;
        yield processed;
        
        done = true;
        break;
      }
      
      // Yield the processed message
      yield processed;
    }
  }
}