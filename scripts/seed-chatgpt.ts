// For practice runs only (NODE_ENV=test, keychain "jeeves-tests"): pretends the person has signed in
// with ChatGPT, so the conversation can be checked against bench/fake-codex.mts.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const tokens = JSON.stringify({ access: 'test-access-token', refresh: 'test-refresh', expires: Date.now() + 3_600_000, accountId: 'acct_test' });
const hex = Buffer.from(tokens, 'utf8').toString('hex');
execFileSync('/usr/bin/security', ['-i'], { input: `add-generic-password -U -s "jeeves-tests" -a "chatgpt" -X "${hex}"\n` });
const file = `${homedir()}/Library/Preferences/jeeves-tests-nodejs/config.json`;
const config = JSON.parse(readFileSync(file, 'utf8'));
config.defaultProvider = 'chatgpt';
config.defaultModel = 'gpt-5.5';
writeFileSync(file, JSON.stringify(config, null, 2));
console.log('practice sign-in seeded (chatgpt, gpt-5.5)');
