// DECSCUSR reset: hands the terminal's own cursor shape back to the shell's default
// on every exit path. The app no longer changes the shape itself - the typing cursor
// is drawn as an inverted cell in the frame (see Input.tsx), as Claude Code draws it.
export const DEFAULT_CURSOR = '\x1b[0 q';
