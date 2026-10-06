import { useEffect } from 'react';
import { ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING } from './mouse.js';

// Turns the mouse on for a screen with buttons to click, and back off when it goes
// (the terminal's own selecting and copying come back on screens that need them).
export function useMouseCapture(active = true): void {
  useEffect(() => {
    if (!active) return;
    try {
      process.stdout.write(ENABLE_MOUSE_TRACKING);
    } catch {
      // A closed stream must never crash the app.
    }
    return () => {
      try {
        process.stdout.write(DISABLE_MOUSE_TRACKING);
      } catch {
        // Same.
      }
    };
  }, [active]);
}
