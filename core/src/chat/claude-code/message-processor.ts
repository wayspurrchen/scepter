import type { SDKMessage } from '@anthropic-ai/claude-code';
import type { ProcessedMessage, DomainMessage } from '../types';

export class MessageProcessor {
  private seenMessageIds = new Set<string>();
  private messageCount = 0;

  reset(): void {
    this.seenMessageIds.clear();
    this.messageCount = 0;
  }

  processMessage(message: SDKMessage, isResume: boolean = false): ProcessedMessage {
    const messageId = this.getMessageId(message);
    const isReplay = isResume && this.seenMessageIds.has(messageId);

    if (!isReplay) {
      this.seenMessageIds.add(messageId);
      this.messageCount++;
    }

    return {
      original: message,
      content: this.extractContent(message),
      isReplay,
      timestamp: new Date(),
    };
  }

  private getMessageId(message: SDKMessage): string {
    // Create a unique ID for each message based on its content
    if (message.type === 'system' && message.subtype === 'init') {
      return `system-init-${message.session_id}`;
    }
    if (message.type === 'assistant' || message.type === 'user') {
      // Use the message ID if available
      if ('id' in message.message) {
        return message.message.id;
      }
      // Fallback to content hash
      return `${message.type}-${this.messageCount}`;
    }

    if (message.type === 'result') {
      return `result-${message.session_id}-${message.subtype}`;
    }

    // @ts-ignore
    console.warn(`Unknown message type: ${message.type}`);

    // @ts-ignore
    return `${message.type}-${this.messageCount}`;
  }

  private extractContent(message: SDKMessage): string | undefined {
    if (message.type === 'assistant') {
      const contentBlocks = message.message.content;
      if (Array.isArray(contentBlocks) && contentBlocks.length > 1) {
        console.warn(
          `Assistant message content has more than 1 block (length: ${contentBlocks.length}):`,
          contentBlocks,
        );
      }
      const textContent = contentBlocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      return textContent || undefined;
    }

    if (message.type === 'user') {
      // Extract user message content
      const content = message.message.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        if (content.length > 1) {
          console.warn(`User message content has more than 1 block (length: ${content.length}):`, content);
        }
        return content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
      }
    }

    return undefined;
  }

  toDomainMessage(processed: ProcessedMessage): DomainMessage | null {
    const { original } = processed;

    if (original.type === 'assistant') {
      return {
        type: 'assistant',
        content: processed.content || '',
        metadata: {
          model: original.message.model,
          usage: original.message.usage,
        },
      };
    }

    if (original.type === 'user') {
      return {
        type: 'user',
        content: processed.content || '',
        metadata: {},
      };
    }

    if (original.type === 'system') {
      return {
        type: 'system',
        content: `System: ${original.subtype}`,
        metadata: {
          subtype: original.subtype,
          sessionId: original.session_id,
        },
      };
    }

    // Skip result messages in domain representation
    return null;
  }
}
