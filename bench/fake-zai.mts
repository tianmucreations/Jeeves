// A pretend Z.ai: answers every request with a long streamed reply (about 900
// words, ~30 words a second) so streaming, scrolling and copying can be tested
// for free and identically every time. Run: npx tsx bench/fake-zai.mts (port 4123),
// then start Jeeves with NODE_ENV=test JEEVES_ZAI_BASE_URL=http://127.0.0.1:4123.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
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
    // Scripted job for checking the to-do list on screen: a message containing TODOTEST
    // gets three todoList calls (a few seconds apart) and then a short answer.
    let parsed: any = {};
    try { parsed = JSON.parse(body); } catch {}
    const msgs: any[] = parsed.messages ?? [];
    if (process.env.FAKE_LOG) { appendFileSync(process.env.FAKE_LOG, JSON.stringify({ rulebookHasMemory: String((msgs.find((m) => m.role === 'system') ?? {}).content ?? '').includes('What You Remember'), rulebookHasNote: String((msgs.find((m) => m.role === 'system') ?? {}).content ?? '').includes('Prefers tea over coffee') }) + '\n'); const u = [...msgs].reverse().find((m) => m.role === 'user'); appendFileSync(process.env.FAKE_LOG, JSON.stringify({ model: parsed.model, parts: Array.isArray(u?.content) ? u.content.map((p: any) => p.type + (p.image_url ? ':' + String(p.image_url.url).slice(0, 30) : '')) : 'text' }) + '\n'); }
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const said = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
    // A helper's own conversation (its rulebook begins "You are a helper for Jeeves"): answer with a short report at once.
    const rules = String((msgs.find((m) => m.role === 'system') ?? {}).content ?? '');
    if (rules.includes('You are a helper for Jeeves')) {
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `HELPER REPORT for "${said.slice(0, 30)}"` } }] });
        send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 6, total_tokens: 56 } });
        res.write('data: [DONE]\n\n'); res.end();
      }, 700);
      return;
    }
    if (said.includes('HELPERTEST')) {
      // Two helpers at once (two tool calls in one reply), then an answer that repeats what came back.
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const reports = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join(' | ');
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step === 0) {
          const call = (index: number, task: string) => ({ index, id: `call_h${index}`, type: 'function', function: { name: 'helper', arguments: JSON.stringify({ task }) } });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [call(0, 'Look at folder Alpha and report.'), call(1, 'Look at folder Beta and report.')] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `Both helpers reported: ${reports}`.slice(0, 300) } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 600);
      return;
    }
    if (said.includes('OFFERTEST')) {
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const last = [...msgs].reverse().find((m) => m.role === 'tool');
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step === 0) {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_o', type: 'function', function: { name: 'offerPlan', arguments: JSON.stringify({ reason: 'it changes many files' }) } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `Offer result: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}` } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 1200);
      return;
    }
    if (said.includes('SEARCHTEST')) {
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const last = [...msgs].reverse().find((m) => m.role === 'tool');
      const out = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step === 0) {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_s', type: 'function', function: { name: 'searchFiles', arguments: JSON.stringify({ pattern: 'heating', path: '/private/tmp/jv-search', ignoreCase: true }) } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `Search result: ${out.replace(/\s+/g, ' ').slice(0, 160)}` } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 600);
      return;
    }
    if (said.includes('REWINDTEST')) {
      // "REWINDTEST name.txt words": writes /private/tmp/jv-rewind/proj/name.txt (after the person allows it), then says done.
      const [, file, content] = said.split(/\s+/);
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step === 0) {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_w', type: 'function', function: { name: 'writeFile', arguments: JSON.stringify({ path: `/private/tmp/jv-rewind/proj/${file}`, content }) } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `Done with ${file}.` } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 600);
      return;
    }
    if (said.includes('MEMTEST')) {
      // Asks Jeeves to remember one thing (a memory tool call), then answers.
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step === 0) {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_m', type: 'function', function: { name: 'memory', arguments: JSON.stringify({ action: 'remember', note: 'Prefers tea over coffee', about: 'me' }) } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: 'Noted, I will remember that.' } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 800);
      return;
    }
    if (said.includes('PLANTEST')) {
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const last = [...msgs].reverse().find((m) => m.role === 'tool');
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const call = (name: string, args: unknown) => {
        send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
        send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
      };
      setTimeout(() => {
        if (step === 0) call('writeFile', { path: '/private/tmp/jv-plan-test.txt', content: 'should be refused' });
        else if (step === 1) call('presentPlan', { plan: '1. Look at the invoices\n2. Rename them\n3. Write a summary' });
        else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `Plan result: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}` } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 1200);
      return;
    }
    if (said.includes('QUESTIONTEST')) {
      // One askQuestion call, then a short answer that repeats what the person chose.
      const toolMsg = [...msgs].reverse().find((m) => m.role === 'tool' && msgs.indexOf(m) > msgs.lastIndexOf(lastUser));
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (!toolMsg) {
          const args = JSON.stringify({ question: 'Which folder should I put the summary in?', options: [{ label: 'Documents (Recommended)', description: 'easy to find' }, { label: 'Desktop' }, { label: 'Downloads', description: 'gets cleared out' }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_q', type: 'function', function: { name: 'askQuestion', arguments: args } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `You picked: ${typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)}` } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 1500);
      return;
    }
    // BGTEST: starts one command in the background (sleep 300), then answers - for checking
    // the "1 task running" note, /tasks and its Stop button.
    if (said.includes('BGTEST')) {
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step < 1) {
          const args = JSON.stringify({ command: 'sleep 300', background: true });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_bg', type: 'function', function: { name: 'runBash', arguments: args } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: 'The preview is running.' } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 500);
      return;
    }
    if (typeof lastUser?.content === 'string' ? lastUser.content.includes('TODOTEST') : JSON.stringify(lastUser?.content ?? '').includes('TODOTEST')) {
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const lists = [
        [['Find the invoices', 'in_progress'], ['Rename them', 'pending'], ['Make a summary', 'pending']],
        [['Find the invoices', 'completed'], ['Rename them', 'in_progress'], ['Make a summary', 'pending']],
        [['Find the invoices', 'completed'], ['Rename them', 'completed'], ['Make a summary', 'completed']],
      ];
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step < 3) {
          const args = JSON.stringify({ todos: lists[step].map(([content, status]) => ({ content, status })) });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${step}`, type: 'function', function: { name: 'todoList', arguments: args } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: 'All three steps are done.' } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 3000);
      return;
    }
    // LONGJOB: a 30-step job (one past the old 25-step stop). Steps 1-9 and 11-29
    // run `echo step-N`, step 10 changes directory silently, step 30 runs pwd whose
    // output proves the directory carried over. Then a plain finished answer - the
    // job must never stop to ask the person to type "continue".
    if (typeof lastUser?.content === 'string' ? lastUser.content.includes('LONGJOB') : JSON.stringify(lastUser?.content ?? '').includes('LONGJOB')) {
      const step = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool').length;
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      setTimeout(() => {
        if (step < 30) {
          const command = step === 9 ? 'cd /private/tmp' : step === 29 ? 'pwd' : `echo step-${step + 1} of 30`;
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${step}`, type: 'function', function: { name: 'runBash', arguments: JSON.stringify({ command }) } }] } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
        } else {
          const tools = msgs.slice(msgs.lastIndexOf(lastUser) + 1).filter((m) => m.role === 'tool');
          const last = String(tools[tools.length - 1]?.content ?? '');
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: { content: `All 30 steps are done, and the job is complete. The last command saw: ${last.replace(/\s+/g, ' ').slice(0, 80)}` } }] });
          send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
        }
        res.write('data: [DONE]\n\n'); res.end();
      }, 250);
      return;
    }
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
