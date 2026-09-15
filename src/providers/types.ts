import type { ModelMessage, ToolSet } from 'ai';

export interface ToolCallNote {
  id: string;
  name: string;
}

export interface StreamResult {
  text: string;
  reasoning: string;
  messages: ModelMessage[];
  usage: { input: number; output: number; total: number };
  cost: number;
}

export interface StreamOptions {
  modelId: string;
  messages: ModelMessage[];
  tools: ToolSet;
  onToken: (token: string) => void;
  onReasoning: (delta: string) => void;
  onToolCall: (call: ToolCallNote) => void;
}

export interface Provider {
  id: string;
  name: string;
  stream(options: StreamOptions): Promise<StreamResult>;
}