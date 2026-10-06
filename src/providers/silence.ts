// A stalled reply must never leave Jeeves "working" forever - but the time a
// command runs, or the time the person takes to answer "allow?", is not the model
// going quiet. The AI SDK's timeout.chunkMs counts both (measured 19 Sept: a 2 s tool
// tripped a 1 s chunkMs), so any command over 90 s cancelled the whole job and
// blamed the service. This watchdog counts silence only while no tool is running.
export const SILENCE_MS = 90_000;

export interface SilenceGuard {
  signal: AbortSignal;
  // Every part of the reply, as it arrives.
  onPart(part: { type: string }): void;
  // Ends the watch. If the watchdog cut the reply short, throws its timeout error:
  // a cut-off reply otherwise ends quietly, as if finished (measured 19 Sept), and
  // half an answer would be shown as the whole one.
  stop(): void;
}

export function silenceGuard(outer?: AbortSignal, ms = SILENCE_MS): SilenceGuard {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let toolsRunning = 0;
  const arm = () => {
    clearTimeout(timer);
    if (toolsRunning > 0) return;
    // Named as the SDK names its own, so the plain-English message stays the same.
    timer = setTimeout(() => controller.abort(new DOMException(`Chunk timeout of ${ms}ms exceeded`, 'TimeoutError')), ms);
    // A finished or stopped reply never keeps Jeeves (or a test run) waiting on this timer.
    timer.unref();
  };
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  return {
    signal: controller.signal,
    onPart(part) {
      if (part.type === 'tool-call') toolsRunning += 1;
      else if (part.type === 'tool-result' || part.type === 'tool-error' || part.type === 'tool-output-denied') toolsRunning = Math.max(0, toolsRunning - 1);
      arm();
    },
    stop() {
      clearTimeout(timer);
      if (controller.signal.aborted && !outer?.aborted) throw controller.signal.reason;
    },
  };
}
