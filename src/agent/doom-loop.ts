// OpenCode's doom-loop guard (session/processor.ts): the same tool call with the
// same input, three times in a row, cannot be worth a fourth try - the answer is
// already in the conversation. Cheap models fall into this exact hole, and every
// loop costs plan credits. The third identical call is refused and the model is
// told, in plain words, to stop and speak to the person instead.

let lastCall: string | null = null;
let callBefore: string | null = null;

function callKey(tool: string, input: unknown): string {
  // Key order from a model is not guaranteed, so sort before comparing.
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  };
  return `${tool}:${stable(input)}`;
}

// A fresh turn starts with a clean slate.
export function resetDoomLoop(): void {
  lastCall = null;
  callBefore = null;
}

// Returns the refusal for a third identical call in a row, or null to let it pass.
export function doomLoopCheck(tool: string, input: unknown): string | null {
  const key = callKey(tool, input);
  if (key === lastCall && key === callBefore) {
    lastCall = null;
    callBefore = null;
    return (
      'The very same call has now been made three times in a row with the same input, so it cannot work. ' +
      'Do not try it again. Stop and tell the person plainly what you were trying to do, why it will not go through, and what you need from them.'
    );
  }
  callBefore = lastCall;
  lastCall = key;
  return null;
}
