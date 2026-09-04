const path = require('path');
const { GoogleGenAI, createUserContent, createPartFromUri } = require('@google/genai');
const { getClassificationSchema, getExtractionSchema, registryCatalogForPrompt } = require('../registry/build-schema');

// `-latest` aliases instead of a pinned dated model: this project's whole
// premise is that it shouldn't need code changes as things move underneath it.
const CLASSIFY_MODEL = process.env.GEMINI_CLASSIFY_MODEL || 'gemini-flash-latest';
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL || 'gemini-pro-latest';

// A single-slot server has exactly one job running at a time — a network
// call that stalls with no timeout hangs that job (and blocks every future
// upload) forever instead of failing. Every SDK call below is bounded.
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;
const httpOptions = { timeout: REQUEST_TIMEOUT_MS };

function createClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY. Copy .env.example to .env and set GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>.',
    );
  }
  return new GoogleGenAI({ apiKey });
}

// Uploads via the Files API and waits for the async processing Gemini does
// on PDFs (OCR/layout) to reach ACTIVE before it can be referenced in a
// generateContent call.
async function uploadDocument(ai, filePath) {
  // NOTE: files.upload() uses a resumable-upload protocol internally, and
  // passing `httpOptions` into its config breaks that (confirmed: it turns
  // a normal upload into a 404). The outer withTimeout()/withRetry() below
  // still bound this call from the outside, without touching the SDK's own
  // request shape.
  const uploaded = await withRetry(() =>
    ai.files.upload({
      file: filePath,
      config: { mimeType: 'application/pdf', displayName: path.basename(filePath) },
    }),
  );
  return waitUntilActive(ai, uploaded);
}

// The API occasionally returns a transient 503 ("deadline expired") under
// load, or a call can stall past REQUEST_TIMEOUT_MS with no response at
// all — retry a few times with backoff before surfacing either as a real
// failure, rather than letting a stalled call hang the single-slot server.
// Belt-and-suspenders: `httpOptions.timeout` should bound every call above,
// but if the SDK ever fails to honor it (a hung DNS lookup, a stalled
// socket before the request is even sent), this guarantees the promise
// still settles instead of leaving the single-slot server stuck forever.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withRetry(fn, { attempts = 3, baseDelayMs = 3000, label = 'request' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await withTimeout(fn(), REQUEST_TIMEOUT_MS + 15000, label);
    } catch (err) {
      lastErr = err;
      const transient = /503|UNAVAILABLE|deadline|timeout|ETIMEDOUT|ECONNRESET/i.test(err.message || err.name || '');
      if (!transient || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

async function waitUntilActive(ai, file, { pollMs = 2000, timeoutMs = 180000 } = {}) {
  const started = Date.now();
  let current = file;
  while (current.state === 'PROCESSING') {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${current.name} to become ACTIVE.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    current = await withRetry(() => ai.files.get({ name: current.name, config: { httpOptions } }));
  }
  if (current.state !== 'ACTIVE') {
    throw new Error(`File ${current.name} failed to process: ${JSON.stringify(current.error || current.state)}`);
  }
  return current;
}

const CLASSIFY_PROMPT = `You are looking at a scanned Indian property/title document. It may be printed, handwritten, or a mix; it may be in English, Tamil, or both on the same page; it will usually carry non-judicial stamp paper watermarks and registrar ink stamps.

Classify it against exactly this registry of known document types:
${registryCatalogForPrompt()}

If the document is a multi-page PDF, base the classification on the primary deed it contains (a registration receipt bundled ahead of or behind the deed does not change the classification of the deed itself — but if the PDF's dominant content is itself just a receipt/acknowledgement with no deed text, classify it as REGISTRATION_RECEIPT).

If nothing in the registry genuinely fits, return UNCLASSIFIED and suggest a label — do not force a poor match.`;

async function classifyDocument(ai, file) {
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: CLASSIFY_MODEL,
      contents: createUserContent([createPartFromUri(file.uri, file.mimeType), CLASSIFY_PROMPT]),
      config: {
        responseMimeType: 'application/json',
        responseSchema: getClassificationSchema(),
        httpOptions,
      },
    }),
  );
  return JSON.parse(response.text);
}

function extractPrompt(docTypeLabel) {
  return `You are looking at a scanned Indian property/title document already classified as a "${docTypeLabel}". It may be printed, handwritten, or mixed Tamil/English, with stamp-paper watermarks and registrar ink stamps that are not part of the deed text.

Extract every field in the schema exactly as written in the document. Rules:
- Never invent a value. If a field is not present or not legible, omit it (or use null/empty array) rather than guessing.
- Transcribe numbers, dates, and names exactly as printed, including any inconsistent spelling — do not normalize or correct them.
- For every value you extract for a field listed under "citations", record which page it came from (pages are 1-indexed in the order supplied) and a short supporting quote.
- If a party's identity or a figure is genuinely ambiguous or hard to read, still extract your best reading and say so in "notes" rather than silently skipping it.`;
}

async function extractFields(ai, file, typeId) {
  const { getDocType } = require('../registry/doc-types');
  const docType = getDocType(typeId);
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: EXTRACT_MODEL,
      contents: createUserContent([createPartFromUri(file.uri, file.mimeType), extractPrompt(docType.label)]),
      config: {
        responseMimeType: 'application/json',
        responseSchema: getExtractionSchema(typeId),
        httpOptions,
      },
    }),
  );
  return JSON.parse(response.text);
}

module.exports = { createClient, uploadDocument, classifyDocument, extractFields };
