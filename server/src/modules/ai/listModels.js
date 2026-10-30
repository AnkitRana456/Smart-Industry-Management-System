import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';

if (!env.geminiApiKey) {
  console.error('Set GEMINI_API_KEY in server/.env first.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
const pager = await ai.models.list();
for await (const m of pager) {
  if (m.supportedActions?.includes('generateContent')) console.log(m.name?.replace(/^models\//, ''));
}
