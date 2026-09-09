import config from '@shared/config';

import type { GenerateApiOptions, TransformResp } from '../interfaces';

let i = 0;
const DEBUG = false;

async function mockResponse<T>(data: T): Promise<T> {
  const delay = Math.floor(Math.random() * 1000);
  return new Promise<T>((resolve) => {
    setTimeout(() => {
      resolve(data);
    }, delay);
  });
}

export async function generateApi({
  prompt,
  model,
  tokens,
  signal,
  temperature,
}: GenerateApiOptions): Promise<TransformResp> {
  if (DEBUG) {
    return mockResponse({ replies: [String(i++), String(i++), String(i++)] });
  }

  const resp = await fetch(`${config.endpoint}/generate/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      prompt,
      model,
      length: tokens,
      temperature,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Generation failed (HTTP ${resp.status})`);
  }
  const data: TransformResp = await resp.json();
  if (!data || !Array.isArray(data.replies) || !data.replies.length ||
      !data.replies.every((reply) => typeof reply === 'string')) {
    throw new Error('Invalid generation response');
  }
  return data;
}

export async function getModelsApi(): Promise<string[]> {
  if (DEBUG) {
    return mockResponse(['gpt3', 'frida']);
  }

  const resp = await fetch(`${config.endpoint}/models`, {
    method: 'GET',
  });
  if (!resp.ok) {
    throw new Error(`Model list failed (HTTP ${resp.status})`);
  }
  const data: string[] = await resp.json();
  if (!Array.isArray(data) || !data.length ||
      !data.every((model) => typeof model === 'string' && model.length > 0)) {
    throw new Error('Invalid model list');
  }
  return data;
}
