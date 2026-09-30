// A pretend ChatGPT "Codex" service. It is strict: it refuses a request that lacks the plan's
// sign-in, the account id, the rulebook in the `instructions` field, or `store: false`, and says
// what was wrong - so what Jeeves sends can be checked without a ChatGPT account. It records each
// request in FAKE_CODEX_LOG. Run: npx tsx bench/fake-codex.mts (port 4124), then start Jeeves with
// NODE_ENV=test JEEVES_CHATGPT_ENDPOINT=http://127.0.0.1:4124/codex.
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const log = (o: unknown) => process.env.FAKE_CODEX_LOG && appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(o) + '\n');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url !== '/codex' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    let parsed: any = {};
    try { parsed = JSON.parse(body); } catch {}
    const problems: string[] = [];
    if (req.headers.authorization !== `Bearer ${process.env.FAKE_CODEX_ACCESS ?? 'test-access-token'}`) problems.push(`authorization was ${req.headers.authorization}`);
    if (req.headers['chatgpt-account-id'] !== 'acct_test') problems.push(`ChatGPT-Account-Id was ${req.headers['chatgpt-account-id']}`);
    if (typeof parsed.instructions !== 'string' || parsed.instructions.length < 20) problems.push('instructions (the rulebook) missing');
    if (parsed.store !== false) problems.push(`store was ${parsed.store}, must be false`);
    if (parsed.stream !== true) problems.push('stream was not true');
    if (Array.isArray(parsed.input) && parsed.input.some((m: any) => m.role === 'system')) problems.push('a system message is in the input (the rulebook must be in instructions)');
    log({ model: parsed.model, problems, hasInstructions: typeof parsed.instructions === 'string', store: parsed.store, inputRoles: (parsed.input ?? []).map((m: any) => m.role) });
    if (problems.length) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `Pretend Codex refused: ${problems.join('; ')}` } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o: unknown) => res.write(`event: ${(o as any).type}\ndata: ${JSON.stringify(o)}\n\n`);
    const text = 'Hello from the pretend ChatGPT plan.';
    send({ type: 'response.created', response: { id: 'resp_1', object: 'response', created_at: 0, status: 'in_progress', model: parsed.model, output: [] } });
    send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', status: 'in_progress', role: 'assistant', content: [] } });
    send({ type: 'response.content_part.added', item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    for (const word of text.split(/(?<= )/)) send({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: word });
    send({ type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text });
    send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] } });
    send({ type: 'response.completed', response: { id: 'resp_1', object: 'response', created_at: 0, status: 'completed', model: parsed.model, output: [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 } } });
    res.end();
  });
});
server.listen(4124, '127.0.0.1', () => console.log('fake codex on 4124'));
