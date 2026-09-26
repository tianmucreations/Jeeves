// Prints Jeeves's actual answers to a few everyday questions (no tools) so the
// wording can be read. Run: NODE_ENV=test JEEVES_KEYCHAIN_SERVICE=jeeves-tests npx tsx bench/answers-26sept.mts
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { execFileSync } from 'node:child_process';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';
import { TOOLS } from '../src/tools/index.js';
const key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'jeeves-tests', '-a', 'zai', '-w'], { encoding: 'utf8' }).trim();
const client = createOpenAICompatible({ name: 'zai', apiKey: key, baseURL: 'https://api.z.ai/api/coding/paas/v4' });
for (const q of ['What is a mortgage offset account?', 'Explain what an API is, I am not technical.', 'Should I use a credit card or a debit card for online shopping?', 'Hello Jeeves']) {
  const r = await generateText({ model: client.chatModel('glm-5.3-flash'), instructions: getSystemPrompt('glm-5.3-flash'), messages: [{ role: 'user', content: q }], tools: TOOLS, maxRetries: 0 });
  console.log(`\n### ${q}\n${r.text}\n(${r.text.length} chars, ${r.usage.outputTokens} tokens)`);
}
