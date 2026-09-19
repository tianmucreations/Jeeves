// Words that depend on the computer Jeeves is running on (owner, 19 Sept: "What
// if it is on a non-Mac?"). Keys are kept by keytar in Windows Credential Manager
// and in the system password store on Linux; the copy keys are the terminal's own
// (Windows Terminal's defaults include Ctrl+Shift+C - learn.microsoft.com, Windows
// Terminal actions; Linux terminals use the same).
const platform = process.platform;

export const KEY_STORE = platform === 'darwin' ? 'your Mac keychain' : platform === 'win32' ? 'Windows Credential Manager' : "your computer's password store";
export const KEY_STORE_SUBJECT = platform === 'darwin' ? 'The Mac keychain' : platform === 'win32' ? 'Windows Credential Manager' : "Your computer's password store";
export const COPY_KEYS = platform === 'darwin' ? 'Cmd+C' : 'Ctrl+Shift+C';
export const WORD_JUMP_KEYS = platform === 'darwin' ? 'Option+← →' : 'Ctrl+← →';
