import { describe, it, expect } from 'vitest';
import { isMouseSequence, parseMouseSequence, handleMouseInput } from '../src/ink/mouse.js';
import { session } from '../src/state/session.js';

describe('SGR mouse parsing', () => {
  it('recognises wheel events with or without the leading escape', () => {
    expect(isMouseSequence('\x1b[<64;10;10M')).toBe(true);
    expect(isMouseSequence('[<65;30;5M')).toBe(true);
    expect(isMouseSequence('a')).toBe(false);
    expect(isMouseSequence('\x1b[A')).toBe(false);
  });

  it('parses wheel up as button 0 and wheel down as button 1', () => {
    const up = parseMouseSequence('\x1b[<64;10;10M');
    expect(up).toEqual({ kind: 'wheel', button: 0, col: 10, row: 10 });
    const down = parseMouseSequence('\x1b[<65;3;2M');
    expect(down).toEqual({ kind: 'wheel', button: 1, col: 3, row: 2 });
  });

  it('recognises presses, drags and releases', () => {
    expect(parseMouseSequence('\x1b[<0;5;5M')?.kind).toBe('press');
    expect(parseMouseSequence('\x1b[<0;5;5m')?.kind).toBe('release');
    expect(parseMouseSequence('\x1b[<32;5;5M')?.kind).toBe('drag');
    expect(parseMouseSequence('\x1b[<35;5;5M')).toBeNull();
  });
});

// THE NEW MOUSE ORDER (3 Oct): in the plain conversation there IS no app mouse
// handling - reporting is off and the wheel, scrollbar and click-drag selection
// belong to the terminal (that is what native scrolling is). The app only ever
// sees reports where something of ours is clickable, so the routing is: a
// question's choices, the info bar's buttons, the Allow buttons, the typing
// box; and the wheel only ever reaches the typing box's own read-back.
describe('click routing when the mouse is live', () => {
  it('a question choice wins, then the info bar, then the Allow buttons, then the typing box', () => {
    const calls: string[] = [];
    session.questionClick = () => (calls.push('question'), true);
    session.footerClick = () => (calls.push('footer'), true);
    session.approvalClick = () => calls.push('approval');
    session.inputClick = () => calls.push('input');
    handleMouseInput('\x1b[<0;5;5M');
    session.questionClick = null;
    handleMouseInput('\x1b[<0;5;5M');
    session.footerClick = null;
    session.approvalPending = true;
    handleMouseInput('\x1b[<0;5;5M');
    session.approvalPending = false;
    handleMouseInput('\x1b[<0;5;5M');
    expect(calls).toEqual(['question', 'footer', 'approval', 'input']);
    session.approvalClick = null;
    session.inputClick = null;
  });

  it('the wheel over the typing box goes to the box, and nowhere else - the conversation scrolls natively', () => {
    let wheels: [number, boolean][] = [];
    session.inputWheel = (row, up) => {
      wheels.push([row, up]);
    };
    handleMouseInput('\x1b[<64;10;7M');
    handleMouseInput('\x1b[<65;10;8M');
    expect(wheels).toEqual([[7, true], [8, false]]);
    session.inputWheel = null;
  });
});
