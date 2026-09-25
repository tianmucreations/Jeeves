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
  // What each step of the job cost, where the service reports it (OpenRouter).
  stepCosts?: number[];
  // True when the step cap stopped a job that still wanted to call tools - the
  // loop ends it with a plain summary instead of a dead stop (OpenCode).
  hitStepCap?: boolean;
  // Why the model stopped its final answer ('length' = cut off by its own size
  // limit - Claude Code's withheld-error recovery case).
  finishReason?: string;
}

// Called before each step of a job: may swap the model for that step (Auto mode's
// expert taking over) and replace the messages (housekeeping during a long job).
export interface StepInfo {
  stepNumber: number;
  // Failed tool actions in each finished step, oldest first.
  stepFailures: number[];
  // What each finished step cost, where the service reports it (OpenRouter).
  stepCosts: number[];
  messages: ModelMessage[];
}

export interface StepControl {
  modelId?: string;
  messages?: ModelMessage[];
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
  beforeStep?: (info: StepInfo) => StepControl | Promise<StepControl>;
  abortSignal?: AbortSignal;
}

export interface Provider {
  id: string;
  name: string;
  stream(options: StreamOptions): Promise<StreamResult>;
}