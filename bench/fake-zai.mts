// A pretend Z.ai: answers every request with a long streamed reply (about 900
// words, ~30 words a second) so streaming, scrolling and copying can be tested
// for free and identically every time. Run: npx tsx bench/fake-zai.mts (port 4123),
// then start Jeeves with NODE_ENV=test JEEVES_ZAI_BASE_URL=http://127.0.0.1:4123.
import http from 'node:http';
const paragraph = (n: number) =>
  n % 5 === 0
    ? `## Chapter ${n}\n\n- **Kingdoms** rose and fell across the peninsula.\n- Trade and *ideas* travelled the old roads.\n- Cities such as **Córdoba** grew large.\n\n`
    : `**Paragraph ${n}.** ` + 'Spain has a long and varied history, shaped by many peoples, kingdoms and ideas over the centuries, with `code-like` words, dates such as 1492 and names like Córdoba. '.repeat(3) + '\n\n';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!req.url?.includes('/chat/completions')) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const words = Array.from({ length: Number(process.env.FAKE_PARAS ?? 40) }, (_, i) => paragraph(i + 1)).join('').split(/(?<= )/);
    let i = 0;
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const timer = setInterval(() => {
      if (i < words.length) { const burst = process.env.FAKE_RANDOM ? 1 + Math.floor(Math.random() * 8) : Number(process.env.FAKE_BURST ?? 1); const part = words.slice(i, i + burst).join(''); i += burst; send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: part } }] }); return; }
      clearInterval(timer);
      send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: words.length, total_tokens: 100 + words.length } });
      res.write('data: [DONE]\n\n'); res.end();
    }, Number(process.env.FAKE_MS ?? 30));
    res.on('close', () => clearInterval(timer));
  });
});
server.listen(4123, '127.0.0.1', () => console.log('fake zai on 4123'));
