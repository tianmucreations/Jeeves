// ─────────────────────────────────────────────────────────────────────────────
// THE SCREEN WRITER — normal-buffer edition (3 Oct).
//
// Until today Jeeves took over the whole window (the "alternate screen"), so
// the terminal's own scrollback was unreachable and Jeeves had to scroll for
// you — the machinery that failed him three times. Claude Code instead prints
// FINISHED content straight into the terminal's own history and redraws only a
// small live block at the bottom; your trackpad and scrollbar work at all
// times, even mid-answer. That is what this file now serves.
//
// How the normal buffer works: the frame is the LAST few rows of the screen.
// After every frame the cursor sits at its end (the bottom). To draw the next
// frame we step up over the old rows erasing each, then write the new rows —
// the standard, battle-tested path every CLI including Claude Code uses.
// Kept from the 2 Oct work because they are right in any buffer:
//   • every row is ANSI-aware clamped to the window width, so a write can
//     never force a scroll (the corruption of his first screenshots);
//   • erase BEFORE write (a full-width row leaves the cursor "about to wrap";
//     an erase after it would eat the row's last character);
//   • a geometry change (resize) erases the whole old frame and repaints.
// Gone on purpose: the home anchor and absolute addressing (\x1b[H) — those
// are alternate-screen moves; in the normal buffer they would jump to the top
// of the screen and fight the scrollback. And the heal ladder: with finished
// text in scrollback and a small live tail, a resize re-wraps history ABOVE
// the frame, where it is allowed to; the tail below is erased and redrawn
// whole, so there is nothing to heal.
// ─────────────────────────────────────────────────────────────────────────────
import cliCursor from 'cli-cursor';
import stringWidth from 'string-width';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET_STYLE = '\x1b[0m';
const ERASE_TO_END = '\x1b[K';
const ERASE_ALL = '\x1b[2K';
const MOVE_UP = '\x1b[1A';
const COLUMN_1 = '\x1b[G';
// Any CSI sequence (colours, erases, cursor moves Ink may embed).
const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// Visible width of a string, counting SGR sequences as zero.
function visibleWidth(text) {
    return stringWidth(text.replace(CSI, ''));
}

// Cut a styled line down to at most `cols` visible columns, keeping the style
// codes of everything written, then close the styles so nothing leaks.
function clampRow(row, cols) {
    if (visibleWidth(row) <= cols) return row;
    let out = '';
    let width = 0;
    let index = 0;
    while (index < row.length) {
        const rest = row.slice(index);
        const match = rest.match(/^\x1b\[[0-9;?]*[A-Za-z]/);
        if (match) {
            out += match[0];
            index += match[0].length;
            continue;
        }
        const character = rest[0];
        const characterWidth = stringWidth(character);
        if (width + characterWidth > cols) break;
        out += character;
        width += characterWidth;
        index += 1;
    }
    return out + RESET_STYLE;
}

// Physically erase a frame of `height` rows, the cursor arriving at column 1
// of the topmost erased row. The cursor must be resting at the end of the
// frame's last row (it always is after a frame write). Erase each row from the
// bottom upward, then step to column 1 — the canonical sequence every CLI of
// this kind uses.
function eraseLines(height) {
    if (height <= 0) return '';
    let out = '';
    for (let index = 0; index < height; index++) {
        out += ERASE_ALL;
        if (index < height - 1) out += MOVE_UP;
    }
    return out + COLUMN_1;
}

const create = (stream, { showCursor = false } = {}) => {
    // How many rows the last frame occupied, and what it looked like.
    let previousRows = null;
    let previousColumns = -1;
    let hasHiddenCursor = false;
    let cursorPosition;
    let cursorDirty = false;
    let previousCursor;
    let cursorWasShown = false;

    const getActiveCursor = () => (cursorDirty ? cursorPosition : undefined);

    const cursorChanged = (a, b) => a?.x !== b?.x || a?.y !== b?.y;

    // Draw the next frame. `prependLines` (optional) are finished lines that
    // have just settled into the terminal's history: they are written ONCE,
    // in the SAME pen stroke as the frame erase — erase old frame, write the
    // new history lines, write the frame — so no intermediate state can ever
    // show, and no separate "clear then write" round-trip can race the
    // throttled writer (the duplicated-frame bug, 3 Oct). This is the same
    // unification Claude Code's own fork makes.
    const render = (str, prependLines) => {
        if (!showCursor && !hasHiddenCursor) {
            cliCursor.hide(stream);
            hasHiddenCursor = true;
        }
        const activeCursor = getActiveCursor();
        cursorDirty = false;
        const rows = str.split('\n').map((line) => clampRow(line, stream.columns || 80));
        // NOTE: the frame arrives with a trailing newline (ink.js appends it),
        // so the last row here is an EMPTY row — and it must STAY in the count:
        // after a frame write the cursor parks on that row (one below the last
        // visible row), so the next frame's erase must cover it too. Popping it
        // was the off-by-one that left old rows surviving above new frames.
        const terminalRows = stream.rows || 24;
        if (rows.length > terminalRows) rows.length = terminalRows;

        const changed = rows.some((row, index) => previousRows?.[index] !== row);
        const moved = cursorChanged(activeCursor, previousCursor);
        // A flush of settled history lines must NEVER be skipped, even when the
        // frame itself is unchanged: the prepend is written exactly once, here
        // or never.
        if (!prependLines?.length && !changed && !moved && previousRows !== null) {
            return false;
        }

        const buffer = [];
        if (prependLines?.length) {
            // HISTORY LINES ARE ARRIVING: clear the viewport and write from the
            // top. The parked cursor cannot be trusted across the terminal's
            // own reflows and scrolls (a resize moved everything once already);
            // writing from home is always right, and whatever scrolls past the
            // bottom lands in the terminal's history, which is exactly where
            // settled lines belong.
            buffer.push('\x1b[2J\x1b[H');
        } else if (previousRows !== null && previousRows.length > 0) {
            // Steady frame: erase the old frame from the parked cursor upward —
            // self-consistent, because this frame's own last write parked it.
            buffer.push(eraseLines(previousRows.length));
        }
        // The freshly settled history lines, once each, above the frame.
        if (prependLines && prependLines.length > 0) {
            buffer.push(prependLines.join('\n') + '\n');
        }
        for (let index = 0; index < rows.length; index++) {
            if (index > 0) buffer.push('\n');
            // Erase-before-write (see header): a full-width row leaves the
            // cursor "about to wrap"; erasing after would eat its last column.
            buffer.push(ERASE_TO_END + RESET_STYLE + rows[index]);
        }        previousRows = rows;
        previousColumns = stream.columns || 80;
        previousCursor = activeCursor ? { ...activeCursor } : undefined;

        // The cursor: Jeeves draws its own typing cursor inside the frame, so
        // this only fires where a screen genuinely asks for the terminal's
        // cursor — placed RELATIVE to the frame (up from its bottom row).
        if (activeCursor) {
            const up = Math.max(0, rows.length - 1 - activeCursor.y);
            buffer.push(MOVE_UP.repeat(up) + `\x1b[${activeCursor.x + 1}G` + SHOW_CURSOR);
            cursorWasShown = true;
        }
        else if (cursorWasShown) {
            buffer.push(HIDE_CURSOR);
            cursorWasShown = false;
        }
        stream.write(buffer.join(''));
        return true;
    };
    render.clear = () => {
        // Forget the frame without touching the screen: settled history lines
        // now travel WITH the next frame (see render's prependLines), so there
        // is no separate clear-and-write step to race anything.
        previousRows = null;
        previousColumns = -1;
        cursorWasShown = false;
    };
    render.erasePrevious = () => {
        // Physically erase the current frame (an external write is about to
        // land above it, and the frame will be redrawn after): erase from the
        // parked cursor upward, then forget.
        if (previousRows !== null && previousRows.length > 0) {
            stream.write(eraseLines(previousRows.length) + COLUMN_1);
        }
        previousRows = null;
        previousColumns = -1;
        cursorWasShown = false;
    };
    render.heal = () => {
        // The alternate-screen heal ladder has no work in the normal buffer:
        // history above the frame is allowed to re-wrap on a resize; the tail
        // below is erased and redrawn whole every frame.
    };
    render.done = () => {
        previousRows = null;
        previousColumns = -1;
        cursorPosition = undefined;
        previousCursor = undefined;
        cursorWasShown = false;
        if (!showCursor) {
            cliCursor.show(stream);
            hasHiddenCursor = false;
        }
    };
    render.reset = () => {
        // Nothing on screen is trusted after a reset: the next render repaints fully.
        previousRows = null;
        previousColumns = -1;
        cursorPosition = undefined;
        previousCursor = undefined;
        cursorWasShown = false;
    };
    render.sync = (str) => {
        // An external program owns the screen; remember nothing, so the next
        // render repaints from scratch (without erasing — the screen isn't ours).
        previousRows = null;
        previousColumns = -1;
        void str;
    };
    render.setCursorPosition = (position) => {
        cursorPosition = position;
        cursorDirty = true;
    };
    render.isCursorDirty = () => cursorDirty;
    render.willRender = (str) => {
        const rows = str.split('\n');
        if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
        const changed = rows.some((row, index) => previousRows?.[index] !== row);
        return changed || previousRows === null || previousColumns !== (stream.columns || 80) || cursorDirty;
    };
    return render;
};

const logUpdate = { create };
export default logUpdate;
