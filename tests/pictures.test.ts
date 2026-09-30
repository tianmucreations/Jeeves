import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { imagePathsIn, addressesIn, loadImageFile, MAX_IMAGE_BYTES } from '../src/platform/images.js';
import { buildTurnMessages } from '../src/agent/context.js';
import { clearOldImages, visionChoice } from '../src/agent/vision.js';
import { normalizeModels } from '../src/models/registry.js';
import { trimCatalogue, toModelInfo } from '../src/providers/catalogue.js';
import { session } from '../src/state/session.js';
import { plainError } from '../src/agent/errors.js';

// A 1x1 png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'jeeves-pics-'));
  await writeFile(path.join(dir, 'shot.png'), PNG);
  await writeFile(path.join(dir, 'my photo.jpg'), PNG);
  await writeFile(path.join(dir, 'notes.txt'), 'hello');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('pictures in a message (OpenCode / Claude Code)', () => {
  it('finds picture files in typed or dropped text - quotes, file:// and (on Mac and Linux) escaped spaces', () => {
    const shot = path.join(dir, 'shot.png');
    expect(imagePathsIn(`what is in ${process.platform === 'win32' ? `"${shot}"` : shot} please`)).toEqual([shot]);
    expect(imagePathsIn(`'${shot}'`)).toEqual([shot]);
    expect(imagePathsIn(`file://${process.platform === 'win32' ? '/' + shot.replace(/\\/g, '/') : shot}`)).toEqual([shot]);
    const spaced = path.join(dir, 'my photo.jpg');
    // A Mac or Linux terminal writes a dropped file with escaped spaces; Windows puts the address in quotes.
    expect(imagePathsIn(process.platform === 'win32' ? `"${spaced}"` : spaced.replace(/ /g, '\\ '))).toEqual([spaced]);
    expect(imagePathsIn(`${path.join(dir, 'notes.txt')} and ${path.join(dir, 'missing.png')}`)).toEqual([]);
    expect(imagePathsIn('no pictures here, just words like image.png')).toEqual([]);
  });
  it('reads both ways of writing an address on every computer (checked without needing the files)', () => {
    // Windows: backslashes are the folder separator and stay; quotes hold a name with spaces.
    expect(addressesIn('look at "C:\\My Files\\shot one.png" and C:\\pics\\b.jpg', true)).toEqual(['C:\\My Files\\shot one.png', 'C:\\pics\\b.jpg']);
    expect(addressesIn('file:///C:/Users/Me/a.png', true)).toEqual(['C:\\Users\\Me\\a.png']);
    // Mac and Linux: a backslash escapes the space after it.
    expect(addressesIn('/Users/me/my\\ photo.png', false)).toEqual(['/Users/me/my photo.png']);
  });
  it('loads a picture as base64, and refuses one over 5 MB in plain words', async () => {
    const loaded = await loadImageFile(path.join(dir, 'shot.png'));
    expect(loaded.ok && loaded.image.mediaType).toBe('image/png');
    expect(loaded.ok && loaded.image.data).toBe(PNG.toString('base64'));
    await writeFile(path.join(dir, 'huge.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    const big = await loadImageFile(path.join(dir, 'huge.png'));
    expect(big.ok).toBe(false);
    expect(!big.ok && big.reason).toContain('over the 5 MB');
  });
  it('sends the words and the pictures as parts of one message', () => {
    const messages = buildTurnMessages([], 'what is this?', [{ mediaType: 'image/png', data: 'AAAA' }]);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'what is this?' }, { type: 'file', data: 'AAAA', mediaType: 'image/png' }]);
    expect(buildTurnMessages([], 'hi')[0].content).toBe('hi');
  });
  it('only the newest picture message keeps its picture', () => {
    const two = [...buildTurnMessages([], 'one', [{ mediaType: 'image/png', data: 'A' }]), { role: 'assistant', content: 'ok' }] as never[];
    const all = [...two, ...buildTurnMessages([], 'two', [{ mediaType: 'image/png', data: 'B' }])] as never[];
    const cleared = clearOldImages(all);
    expect(JSON.stringify(cleared[0])).toContain('removed to keep the conversation small');
    expect(JSON.stringify(cleared[2])).toContain('"data":"B"');
  });
  it('reads whether a model can see from the model lists', () => {
    const list = normalizeModels({ data: [{ id: 'a/seer', architecture: { input_modalities: ['text', 'image'] } }, { id: 'a/blind', architecture: { input_modalities: ['text'] } }, { id: 'a/unknown' }] });
    expect(list.map((m) => m.acceptsImages)).toEqual([true, false, undefined]);
    const catalogue = trimCatalogue({ anthropic: { models: { m: { id: 'm', tool_call: true, modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 200000 } } } } });
    expect(toModelInfo('anthropic', catalogue.anthropic[0]).acceptsImages).toBe(true);
  });
  it('a model known not to see gets the words only, with a plain note; unknown models are tried', () => {
    session.setModels([{ id: 'a/blind', name: 'b', contextLength: 1000, promptPrice: 0, completionPrice: 0, supportedParameters: ['tools'], provider: 'a', acceptsImages: false }, { id: 'a/unknown', name: 'u', contextLength: 1000, promptPrice: 0, completionPrice: 0, supportedParameters: ['tools'], provider: 'a' }], '');
    const blind = visionChoice('a/blind', false);
    expect(blind.send).toBe(false);
    expect(blind.note).toBe("This AI model can't see pictures. Choose a model that does.");
    expect(visionChoice('a/unknown', false)).toEqual({ modelId: 'a/unknown', send: true });
  });
  it('explains a refused picture in plain words', () => {
    expect(plainError(new Error('400 image input is not supported by this model'), 'openrouter').message).toContain("can't see pictures");
  });
  it('queued messages keep their pictures', () => {
    session.queueMessage('later', [{ name: 'x', mediaType: 'image/png', data: 'Z' }]);
    session.queueMessage('plain');
    expect(session.takeNext()).toEqual({ text: 'later', images: [{ name: 'x', mediaType: 'image/png', data: 'Z' }] });
    expect(session.takeNext()).toEqual({ text: 'plain', images: [] });
  });
});
