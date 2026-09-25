// One command before any faithful test boot (the boots that call a real model):
//   npx tsx scripts/seed-test-env.ts
// It prepares the ISOLATED practice environment so a test boot can never spend
// the person's OpenRouter credit again (25 Sept: an unseeded boot ran on
// OpenRouter GLM-5.3 with the real key - a fraction of a cent, never again):
//   1. Seeds the practice settings file from the real one (provider, model,
//      address, projects, limits) - the vitest suite rewrites this file, so
//      re-seed after every suite run.
//   2. Copies ONLY the Z.ai plan key into the practice key ring
//      (JEEVES_KEYCHAIN_SERVICE=jeeves-tests). The OpenRouter key is
//      deliberately NOT copied: a test boot then physically cannot call it.
// Boot afterwards with:
//   NODE_ENV=test JEEVES_KEYCHAIN_SERVICE=jeeves-tests node dist/index.js
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const hex = (value: string) => Buffer.from(value, 'utf8').toString('hex');

// 1. Practice settings, from the real file.
const real = JSON.parse(readFileSync(`${homedir()}/Library/Preferences/jeeves-nodejs/config.json`, 'utf8'));
const seed: Record<string, unknown> = {
  defaultProvider: real.defaultProvider,
  defaultModel: real.defaultModel,
  address: real.address,
  projects: real.projects,
  dailyLimit: real.dailyLimit,
  dailyExtra: real.dailyExtra,
  verbose: false,
};
writeFileSync(`${homedir()}/Library/Preferences/jeeves-tests-nodejs/config.json`, JSON.stringify(seed, null, 2));
console.log(`settings seeded (provider ${String(seed.defaultProvider)}, model ${String(seed.defaultModel)})`);

// 2. The Z.ai plan key into the practice key ring - read from the real ring,
//    written to the test ring, never printed or copied anywhere else.
const key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'jeeves', '-a', 'zai', '-w'], { encoding: 'utf8' }).replace(/\n$/, '');
if (!key) throw new Error('no Z.ai key found in the real key ring');
execFileSync('/usr/bin/security', ['-i'], { input: `add-generic-password -U -s "jeeves-tests" -a "zai" -X "${hex(key)}"\n` });
console.log('practice key ring: zai key copied; openrouter deliberately left out');
