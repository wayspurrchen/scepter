import OpenAI from 'openai';
import type { SimpleLLMFunction } from './types';

export interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
}

export interface ChatCompletionRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
}

const defaultConfig: OpenAIConfig = {
  apiKey: process.env.OPENAI_API_KEY,
};

let openaiClient: OpenAI | null = null;

export function initializeOpenAI(config: OpenAIConfig = {}): void {
  const mergedConfig = { ...defaultConfig, ...config };

  openaiClient = new OpenAI({
    apiKey: mergedConfig.apiKey,
    baseURL: mergedConfig.baseURL,
    organization: mergedConfig.organization,
  });
}

export async function makeOpenAIRequest(request: ChatCompletionRequest, model: string = 'gpt-4.1-nano'): Promise<string> {
  if (!openaiClient) {
    initializeOpenAI();
  }

  if (!openaiClient) {
    throw new Error('OpenAI client not initialized and no API key provided');
  }

  try {
    const completion = await openaiClient.chat.completions.create({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      top_p: request.topP ?? 1,
      frequency_penalty: request.frequencyPenalty ?? 0,
      presence_penalty: request.presencePenalty ?? 0,
      stop: request.stop,
    });

    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`OpenAI API request failed: ${error.message}`);
    }
    throw error;
  }
}

export const sendMessage: SimpleLLMFunction = async (
  message: string,
  model: string = 'gpt-4.1-nano',
  systemPrompt?: string
): Promise<string> => {
  const messages: ChatCompletionRequest['messages'] = [];
  
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  
  messages.push({ role: 'user', content: message });
  
  return makeOpenAIRequest({ messages }, model);
};

export async function streamOpenAIRequest(
  request: ChatCompletionRequest,
  onChunk: (chunk: string) => void,
  model: string = 'gpt-4.1-nano'
): Promise<void> {
  if (!openaiClient) {
    initializeOpenAI();
  }

  if (!openaiClient) {
    throw new Error('OpenAI client not initialized and no API key provided');
  }

  try {
    const stream = await openaiClient.chat.completions.create({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      top_p: request.topP ?? 1,
      frequency_penalty: request.frequencyPenalty ?? 0,
      presence_penalty: request.presencePenalty ?? 0,
      stop: request.stop,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        onChunk(content);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`OpenAI API stream request failed: ${error.message}`);
    }
    throw error;
  }
}
