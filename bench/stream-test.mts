import { streamText, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
setTimeout(() => { console.log('TIMEOUT: still hanging after 30s'); process.exit(9); }, 30_000).unref();
const client = createOpenAICompatible({ name: 'zai', apiKey: 'test', baseURL: 'http://127.0.0.1:4123', includeUsage: true });
const result = streamText({
  instructions: 'test',
  model: client.chatModel('glm-5.3-flash'),
  messages: [{ role: 'user', content: 'tell me about Spain' }],
  tools: {},
  stopWhen: stepCountIs(200),
  onError: () => {},
});
let n = 0;
for await (const part of result.stream) { n++; }
console.log('loop ended after', n, 'parts');
const text = await result.text;
console.log('text ok, length', text.length);
process.exit(0);
