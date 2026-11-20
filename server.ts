import './env.js';
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotManager, WEB_JOBS_DIR } from './bot-manager.ts';
import type { ExtractMode } from './lib.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json({ limit: '2mb' }));

const manager = new BotManager();
await manager.init();

// ───────────────────────── API Routes ─────────────────────────

app.get('/api/health', async (_req, res) => {
  const capabilities = await manager.getCapabilities();
  res.json({ ok: true, capabilities });
});

app.get('/api/bot/status', async (_req, res) => {
  res.json(await manager.getStatus());
});

app.post('/api/bot/connect', async (req, res) => {
  try {
    const pairingPhone = typeof req.body?.pairingPhone === 'string' ? req.body.pairingPhone.trim() : undefined;
    await manager.connect({ pairingPhone: pairingPhone || undefined });
    res.json(await manager.getStatus());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'No se pudo iniciar la conexión.' });
  }
});

app.post('/api/bot/disconnect', async (_req, res) => {
  await manager.disconnect();
  res.json(await manager.getStatus());
});

app.post('/api/bot/logout', async (_req, res) => {
  await manager.logout();
  res.json(await manager.getStatus());
});

app.get('/api/config', (_req, res) => {
  res.json(manager.getConfig());
});

app.put('/api/config', async (req, res) => {
  try {
    const updated = await manager.updateConfig(req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'No se pudo guardar la configuración.' });
  }
});

app.post('/api/extract', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const mode = (['video', 'document', 'audio'].includes(req.body?.mode) ? req.body.mode : undefined) as
      | ExtractMode
      | undefined;
    const trim = typeof req.body?.trim === 'string' ? req.body.trim : undefined;
    const bypassCache = Boolean(req.body?.bypassCache);
    const result = await manager.extractFromWeb({ text, mode, trim, bypassCache });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'No se pudo procesar el enlace.' });
  }
});

app.get('/api/activity', (_req, res) => {
  res.json(manager.getActivity());
});

app.delete('/api/cache', async (_req, res) => {
  await manager.clearCache();
  res.json({ ok: true, cacheSize: 0 });
});

// Stream seguro de medios generados por el extractor web (con soporte Range para video/audio)
app.get('/api/media/:jobId/:fileName', async (req, res) => {
  const safeJob = path.basename(req.params.jobId || '');
  const safeFile = path.basename(req.params.fileName || '');
  const fullPath = path.join(WEB_JOBS_DIR, safeJob, safeFile);

  if (!fullPath.startsWith(WEB_JOBS_DIR + path.sep)) {
    res.status(403).json({ error: 'Ruta no permitida.' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(fullPath);
  } catch {
    res.status(404).json({ error: 'Archivo multimedia expirado o no encontrado.' });
    return;
  }

  const ext = path.extname(safeFile).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  if (req.query.download === '1') {
    const downloadName = path.basename(String(req.query.name || safeFile)).replace(/[^\w.-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', end - start + 1);
        res.setHeader('Content-Type', contentType);
        fs.createReadStream(fullPath, { start, end }).pipe(res);
        return;
      }
    }
  }

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(fullPath).pipe(res);
});

// ───────────────────────── Frontend (Vite dev / dist prod) ─────────────────────────

if (IS_PROD) {
  const distDir = path.join(ROOT, 'dist');
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Video Bot Studio escuchando en http://0.0.0.0:${PORT}`);
});
