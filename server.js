#!/usr/bin/env node
// The upload UI: a small local/deployed server around the same pipeline
// the CLI uses (src/pipeline/run-batch.js). Single-slot by design — this is
// a testing tool, not a multi-tenant service: each new upload wipes and
// replaces whatever was there before (uploaded source files AND generated
// output), rather than accumulating a history of runs. That also makes it
// a good fit for a free host's ephemeral disk — nothing here is meant to
// survive a redeploy or restart.

const fs = require('fs');
const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // fall back to whatever is already in process.env (e.g. a platform's env UI)
}

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { processBatch } = require('./src/pipeline/run-batch');
const { createRunState } = require('./src/pipeline/run-state');
const { createTimings, countPdfPages } = require('./src/pipeline/timings');
const { DOC_TYPES } = require('./src/registry/doc-types');
const { createUserStore } = require('./src/auth/user-store');
const { createAuth, ensureBootstrapAdmin } = require('./src/auth/routes');

const PORT = process.env.PORT || 4174;
const CURRENT_DIR = path.join(__dirname, 'output', 'current');
const UPLOADS_DIR = path.join(CURRENT_DIR, 'uploads');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 20 } });

const TIMINGS_FILE = path.join(__dirname, 'data', 'timings.json');
const docTypeLabel = (id) => DOC_TYPES.find((t) => t.id === id)?.label || 'Unrecognised document';

// The one and only run — overwritten every time, never appended to.
const run = createRunState({ timings: createTimings(TIMINGS_FILE), docTypeLabel });

// Wipe everything from the previous run before starting a new one — the
// overwrite semantics the tool is built around, not just "write on top of".
function clearCurrentDir() {
  fs.rmSync(CURRENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

async function runPipeline(entries, logger = console) {
  try {
    const { matters, unclassified } = await processBatch(entries, {
      outputDir: CURRENT_DIR,
      onProgress: (label, stage, extra) => run.fileEvent(label, stage, extra),
      onPhase: (name) => run.phase(name),
    });
    run.finish(matters, unclassified);
  } catch (err) {
    logger.error('[pipeline]', err);
    run.fail('Something went wrong while preparing the report. Please try again.');
  }
}

const PUBLIC_DIR = path.join(__dirname, 'public');

// Client-supplied filenames become paths on disk. Reduce each to a plain,
// unique file name inside UPLOADS_DIR ("..", "", "a/b" and duplicates
// included) before anything is deleted or written.
function safeUploadNames(files) {
  const seen = new Set();
  return files.map((f, i) => {
    const base = path.basename(String(f.originalname || '').replace(/\\/g, '/'));
    const cleaned = base.replace(/[^\p{L}\p{M}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').trim();
    let storedName = cleaned && cleaned.length <= 120 ? cleaned : `document-${i + 1}.pdf`;
    if (seen.has(storedName)) storedName = `${i + 1}-${storedName}`;
    seen.add(storedName);
    return { label: path.basename(storedName, path.extname(storedName)), buffer: f.buffer, storedName };
  });
}
const MATTER_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// Builds the app around an already-initialised user store, so tests can pass
// their own store and secret without touching the environment.
function createApp({ store, secret, secure = false, logger = console }) {
  const app = express();
  app.set('trust proxy', 1); // Render terminates TLS in front of us; needed for req.ip and Secure cookies
  app.disable('x-powered-by');

  const auth = createAuth({ store, secret, secure, logger });
  app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: 0 }));
  app.use(auth.router);

  // --- pages ---------------------------------------------------------------
  app.get('/login', async (req, res, next) => {
    try {
      if (await auth.currentUser(req)) return res.redirect('/');
      return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
    } catch (err) { return next(err); }
  });
  app.get('/admin', auth.requireAdmin, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
  app.get('/', auth.requireUser, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // --- pipeline (any signed-in user) -----------------------------------------
  app.get('/api/registry', auth.requireUser, (_req, res) => {
    res.json(DOC_TYPES.map((t) => ({ id: t.id, label: t.label, description: t.description })));
  });

  app.post('/api/run', auth.requireUser, upload.array('files', 20), (req, res) => {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }
    if (run.isRunning()) {
      return res.status(409).json({ error: `A run started by ${run.get().startedBy || 'another user'} is in progress — wait for it to finish.` });
    }

    const labeled = safeUploadNames(req.files);

    clearCurrentDir();
    run.start(labeled.map((f) => ({ label: f.label, pages: countPdfPages(f.buffer) })), req.user.username);

    let entries;
    try {
      entries = labeled.map((f) => {
        const filePath = path.join(UPLOADS_DIR, f.storedName);
        fs.writeFileSync(filePath, f.buffer);
        return { label: f.label, file: filePath };
      });
    } catch (err) {
      // Never leave the slot stuck in "running" — that would 409 every later upload.
      logger.error('[upload]', err);
      run.fail('Could not save the uploaded files.');
      return res.status(500).json({ error: 'Could not save the uploaded files.' });
    }

    runPipeline(entries, logger); // fire and forget — client polls /api/status
    return res.json({ ok: true });
  });

  app.get('/api/status', auth.requireUser, (_req, res) => {
    res.json(run.get());
  });

  app.get('/review', auth.requireUser, (_req, res) => {
    const reviewPath = path.join(CURRENT_DIR, 'matter-review.html');
    if (!fs.existsSync(reviewPath)) return res.status(404).send('No review available yet — run the pipeline first.');
    return res.sendFile(reviewPath);
  });

  // The uploaded scans, so the review page can open a cited page directly
  // (`/files/<name>#page=N`). basename() keeps it inside UPLOADS_DIR.
  app.get('/files/:name', auth.requireUser, (req, res) => {
    const filePath = path.join(UPLOADS_DIR, path.basename(req.params.name));
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found.');
    return res.type('application/pdf').sendFile(filePath);
  });

  app.get('/reports/:matterId.docx', auth.requireUser, (req, res) => {
    if (!MATTER_ID_RE.test(req.params.matterId)) return res.status(400).send('Bad report id.');
    const reportPath = path.join(CURRENT_DIR, `Legal-Scrutiny-Report-${req.params.matterId}.docx`);
    if (!fs.existsSync(reportPath)) return res.status(404).send('Report not found.');
    return res.download(reportPath, `Legal-Scrutiny-Report-${req.params.matterId}.docx`);
  });

  // Last-resort handler: log the detail here, never send it to the browser.
  app.use((err, _req, res, _next) => {
    logger.error('[server]', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

// Render sets RENDER=true on its instances, so a forgotten NODE_ENV can't
// silently drop the Secure cookie flag or fall back to a throwaway secret.
const isDeployed = () => process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const MIN_SECRET_LENGTH = 32;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (isDeployed()) {
    throw new Error(`SESSION_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (secret) console.warn(`[auth] SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`);
  if (secret) return secret;
  console.warn('[auth] SESSION_SECRET not set — using a random one; everyone is signed out on restart.');
  return crypto.randomBytes(32).toString('hex');
}

async function start() {
  const store = await createUserStore({
    databaseUrl: process.env.DATABASE_URL,
    filePath: path.join(__dirname, 'data', 'users.json'),
  });
  if (!process.env.DATABASE_URL) {
    console.warn('[auth] DATABASE_URL not set — users are stored in data/users.json (lost on hosts with an ephemeral disk).');
  }
  await ensureBootstrapAdmin(store, { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  const app = createApp({ store, secret: sessionSecret(), secure: isDeployed() });
  app.listen(PORT, () => {
    console.log(`Upload UI running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp, safeUploadNames };
