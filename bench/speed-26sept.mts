// Speed check, 26 Sept: the same question to the same model (glm-5.3-flash on the
// Z.ai plan), once with Jeeves's own rulebook + tools and once with OpenCode's
// default prompt and no tools. Times to first thinking, first words and the end.
// Run: NODE_ENV=test JEEVES_KEYCHAIN_SERVICE=jeeves-tests npx tsx bench/speed-26sept.mts
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';
import { TOOLS } from '../src/tools/index.js';

const key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'jeeves-tests', '-a', 'zai', '-w'], { encoding: 'utf8' }).trim();
const client = createOpenAICompatible({ name: 'zai', apiKey: key, baseURL: 'https://api.z.ai/api/coding/paas/v4', includeUsage: true });
const ocPrompt = readFileSync(process.env.OC_PROMPT!, 'utf8');
const prompts = ['Hello there', 'What is a mortgage offset account?', 'What files are in this folder?'];

async function run(label: string, system: string, tools: any, q: string) {
  const t0 = Date.now();
  let firstThink = 0, firstText = 0, text = '';
  const r = streamText({ model: client.chatModel('glm-5.3-flash'), instructions: system, messages: [{ role: 'user', content: q }], tools, providerOptions: {} , maxRetries: 0 });
  for await (const p of r.stream) {
    if (p.type === 'reasoning-delta' && !firstThink) firstThink = Date.now() - t0;
    if (p.type === 'text-delta') { if (!firstText) firstText = Date.now() - t0; text += p.text; }
  }
  const u = await r.usage;
  console.log(`${label.padEnd(9)} | ${q.slice(0, 34).padEnd(34)} | think@${String(firstThink).padStart(5)}ms text@${String(firstText).padStart(5)}ms total ${String(Date.now() - t0).padStart(5)}ms | in ${u.inputTokens} out ${u.outputTokens} reasoning ${u.outputTokenDetails?.reasoningTokens ?? '?'} | ${text.length} chars`);
}
const q = 'What is a mortgage offset account?';
const full = getSystemPrompt('glm-5.3-flash');
const cut = (t: string, from: string, to: string) => t.slice(0, t.indexOf(from)) + t.slice(t.indexOf(to));
const noResearch = cut(full, 'Researching the Web', 'Permissions');
const noRules = cut(full, 'Being Right', 'Using Your Tools');
const stats: Record<string, number[]> = {};
for (let i = 0; i < 5; i++) {
  for (const [name, sys] of [['full', full], ['noResearch', noResearch], ['noBeingRight+Doing', noRules]] as const) {
    const t0 = Date.now();
    const r = streamText({ model: client.chatModel('glm-5.3-flash'), instructions: sys, messages: [{ role: 'user', content: q }], tools: TOOLS, maxRetries: 0 });
    for await (const _ of r.stream) {}
    (stats[name] ??= []).push(Date.now() - t0);
  }
}
for (const [k, v] of Object.entries(stats)) console.log(k.padEnd(20), v.join(' '), ' median', [...v].sort((a, b) => a - b)[2]);
