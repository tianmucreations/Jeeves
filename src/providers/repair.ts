import { NoSuchToolError, type ToolSet } from 'ai';

// OpenCode's cheap tool-call repair (session/llm.ts experimental_repairToolCall):
// when the model names a tool with different capitalisation and the lowercase name
// exists, fix the name and let the call through. Anything else gets no repair, so
// the model receives the real error and rewrites the input itself.
export async function repairToolCall(options: {
  tools: ToolSet;
  toolCall: { type: 'tool-call'; toolCallId: string; toolName: string; input: string };
  error: unknown;
}): Promise<{ type: 'tool-call'; toolCallId: string; toolName: string; input: string } | null> {
  if (options.error instanceof NoSuchToolError) {
    const lower = options.toolCall.toolName.toLowerCase();
    if (lower !== options.toolCall.toolName && options.tools[lower]) {
      return { ...options.toolCall, type: 'tool-call' as const, toolName: lower };
    }
  }
  return null;
}
