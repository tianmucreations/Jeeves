import type { ModelMessage, ToolSet } from 'ai';

export interface ToolCallNote {
  id: string;
  name: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface StreamResult {
  text: string;
  reasoning: string;
  messages: ModelMessage[];
  usage: { input: number; output: number; total: number; cached?: number };
  cost: number;
  rateLimit: RateLimitInfo | null;
}

export interface StreamOptions {
  modelId: string;
  messages: ModelMessage[];
  tools: ToolSet;
  // The system prompt / rulebook. AI SDK 7 delivers it as streamText's
  // instructions option (role:'system' messages are rejected in the messages array).
  instructions?: string;
  onToken: (token: string) => void;
  onReasoning: (delta: string) => void;
  onToolCall: (call: ToolCallNote) => void;
}

export interface Provider {
  id: string;
  name: string;
  stream(options: StreamOptions): Promise<StreamResult>;
}