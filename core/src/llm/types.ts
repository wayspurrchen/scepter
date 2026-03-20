export enum OpenAIModel {
  GPT_4_1_NANO = 'gpt-4.1-nano',
  GPT_4_1_MINI = 'gpt-4.1-mini',
  GPT_4 = 'gpt-4',
  GPT_4_TURBO = 'gpt-4-turbo',
  GPT_4O = 'gpt-4o',
  GPT_4O_MINI = 'gpt-4o-mini',
  GPT_3_5_TURBO = 'gpt-3.5-turbo',
}

export interface SimpleLLMFunction {
  (message: string, model?: string, systemPrompt?: string): Promise<string>;
}

export interface LLMProvider {
  sendMessage: SimpleLLMFunction;
  makeRequest?: (request: any, model?: string) => Promise<string>;
  streamRequest?: (request: any, onChunk: (chunk: string) => void, model?: string) => Promise<void>;
}
