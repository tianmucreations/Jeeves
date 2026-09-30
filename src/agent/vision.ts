import type { ModelMessage } from 'ai';
import { session } from '../state/session.js';
import { ZAI_MODELS } from '../providers/zai.js';
import { findSeenModel } from '../providers/catalogue.js';
import { expertModel, topModel } from './auto.js';

// Whether a model can look at pictures: true or false where its list says, undefined when
// nothing is known (then Jeeves just tries, and a refusal is explained in plain words).
export function modelSeesImages(modelId: string, providerId = session.providerId): boolean | undefined {
  // The practice runs can name a model that pretends to be blind.
  if (process.env.NODE_ENV === 'test' && process.env.JEEVES_TEST_BLIND_MODEL === modelId) return false;
  const found = session.models.find((model) => model.id === modelId) ?? ZAI_MODELS.find((model) => model.id === modelId) ?? findSeenModel(providerId, modelId);
  return found?.acceptsImages;
}

export interface VisionChoice {
  // The model to use for this message.
  modelId: string;
  // False when no model on offer can look at pictures: they are left out, with `note`.
  send: boolean;
  note?: string;
}

// A message with pictures needs a model that can see them. The chosen one if it can (or
// might); in Auto, the expert or strongest model that can, quietly; otherwise the words go
// alone and the person is told how to fix it.
export function visionChoice(modelId: string, auto: boolean): VisionChoice {
  if (modelSeesImages(modelId) !== false) return { modelId, send: true };
  if (auto) {
    for (const candidate of [expertModel(), topModel()]) {
      if (candidate && modelSeesImages(candidate) !== false) return { modelId: candidate, send: true };
    }
  }
  // Not Auto: the person's own choice is never changed behind their back; they are told
  // plainly and choose (see loop.ts).
  return { modelId, send: false, note: "This AI model can't see pictures. Choose a model that does." };
}

// Pictures cost every time the conversation is re-sent, so only the newest picture message
// keeps its pictures; earlier ones become a short note that they were shown.
const isPicture = (part: { type: string; mediaType?: string }) => part.type === 'image' || (part.type === 'file' && (part.mediaType ?? '').startsWith('image/'));

export function clearOldImages(messages: ModelMessage[]): ModelMessage[] {
  let last = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user' && Array.isArray(message.content) && message.content.some(isPicture)) last = index;
  });
  return messages.map((message, index) => {
    if (index === last || message.role !== 'user' || !Array.isArray(message.content)) return message;
    if (!message.content.some(isPicture)) return message;
    return {
      ...message,
      content: message.content.map((part) => (isPicture(part as never) ? { type: 'text' as const, text: '[A picture was shown here earlier and has been removed to keep the conversation small.]' } : part)),
    } as ModelMessage;
  });
}
