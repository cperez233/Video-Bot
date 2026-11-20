// lib.js — lógica del bot sin WhatsApp: detectar links, comandos, yt-dlp, ffmpeg, caché y formateo.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const exec = promisify(execFile);

export const WA_VIDEO_LIMIT = 16 * 1024 * 1024; // límite práctico de WhatsApp para video
const VIDEO_TARGET = Math.floor(WA_VIDEO_LIMIT * 0.92); // margen de seguridad (~14.7 MB)
const CAPTION_MAX = 1024;
const TOP_COMMENTS = 5;
const COMMENT_MAX_CHARS = 300;

// ───────────────────────── Configuración en caliente ─────────────────────────

const runtimeConfig = {
  maxDurationMin: Number(process.env.MAX_DURATION_MIN || 20) || 20,
  maxDocMb: Number(process.env.MAX_DOC_MB || 100) || 100,
  ytdlpCookies: process.env.YTDLP_COOKIES || '',
  ytdlpBin: process.env.YTDLP_BIN || 'yt-dlp',
  ffmpegBin: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobeBin: process.env.FFPROBE_BIN || 'ffprobe',
};

export function getRuntimeConfig() {
  return { ...runtimeConfig };
}

export function updateRuntimeConfig(patch = {}) {
  if (patch.maxDurationMin !== undefined) {
    const n = Number(patch.maxDurationMin);
    if (Number.isFinite(n) && n >= 1 && n <= 180) runtimeConfig.maxDurationMin = Math.round(n);
  }
  if (patch.maxDocMb !== undefined) {
    const n = Number(patch.maxDocMb);
    if (Number.isFinite(n) && n >= 5 && n <= 500) runtimeConfig.maxDocMb = Math.round(n);
  }
  if (patch.ytdlpCookies !== undefined) {
    runtimeConfig.ytdlpCookies = String(patch.ytdlpCookies || '').trim();
  }
  if (patch.ytdlpBin !== undefined && String(patch.ytdlpBin).trim()) {
    runtimeConfig.ytdlpBin = String(patch.ytdlpBin).trim();
  }
  if (patch.ffmpegBin !== undefined && String(patch.ffmpegBin).trim()) {
    runtimeConfig.ffmpegBin = String(patch.ffmpegBin).trim();
  }
  if (patch.ffprobeBin !== undefined && String(patch.ffprobeBin).trim()) {
    runtimeConfig.ffprobeBin = String(patch.ffprobeBin).trim();
  }
  return getRuntimeConfig();
}

export const SUPPORTED_PLATFORMS = ['youtube', 'x', 'instagram', 'tiktok', 'reddit'];

// ───────────────────────── Detección de links ─────────────────────────

function classifyUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl.replace(/[).,;!?\]"']+$/, ''));
  } catch {
    return { kind: 'unsupported', url: rawUrl };
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|music|old|np)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  // YouTube
  if (host === 'youtu.be' && parts[0]) {
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${parts[0]}`, id: parts[0] };
  }
  if (host === 'youtube.com') {
    if (parts[0] === 'watch' && u.searchParams.get('v')) {
      const id = u.searchParams.get('v');
      return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, id };
    }
    if (['shorts', 'live', 'embed'].includes(parts[0]) && parts[1]) {
      return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${parts[1]}`, id: parts[1] };
    }
  }

  // X / Twitter
  if (['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com'].includes(host)) {
    const i = parts.indexOf('status');
    if (i >= 0 && /^\d+$/.test(parts[i + 1] || '')) {
      const user = parts[0] === 'i' || !parts[0] ? 'i' : parts[0];
      return { kind: 'x', url: `https://x.com/${user}/status/${parts[i + 1]}`, id: parts[i + 1] };
    }
  }

  // Instagram
  if (host === 'instagram.com' || host === 'ddinstagram.com') {
    if (['reel', 'reels', 'p', 'tv'].includes(parts[0]) && parts[1]) {
      const segment = parts[0] === 'reels' ? 'reel' : parts[0];
      return { kind: 'instagram', url: `https://www.instagram.com/${segment}/${parts[1]}/`, id: parts[1] };
    }
    if (parts[0] === 'stories' && parts[1] && parts[2]) {
      return { kind: 'instagram', url: `https://www.instagram.com/stories/${parts[1]}/${parts[2]}/`, id: parts[2] };
    }
  }

  // TikTok
  if (host === 'tiktok.com') {
    if (parts[0]?.startsWith('@') && ['video', 'photo'].includes(parts[1]) && /^\d+$/.test(parts[2] || '')) {
      return { kind: 'tiktok', url: `https://www.tiktok.com/${parts[0]}/${parts[1]}/${parts[2]}`, id: parts[2] };
    }
    if (parts[0] === 't' && parts[1]) {
      return { kind: 'tiktok', url: `https://www.tiktok.com/t/${parts[1]}`, id: parts[1] };
    }
  }
  if (['vm.tiktok.com', 'vt.tiktok.com'].includes(host) && parts[0]) {
    return { kind: 'tiktok', url: `https://${host}/${parts[0]}`, id: parts[0] };
  }

  // Reddit
  if (host === 'reddit.com') {
    if (parts[0] === 'r' && parts[1] && parts[2] === 'comments' && parts[3]) {
      return { kind: 'reddit', url: `https://www.reddit.com/r/${parts[1]}/comments/${parts[3]}/`, id: parts[3] };
    }
    if (parts[0] === 'r' && parts[1] && parts[2] === 's' && parts[3]) {
      return { kind: 'reddit', url: `https://www.reddit.com/r/${parts[1]}/s/${parts[3]}`, id: parts[3] };
    }
  }
  if (host === 'redd.it' && parts[0]) {
    return { kind: 'reddit', url: `https://redd.it/${parts[0]}`, id: parts[0] };
  }

  return { kind: 'unsupported', url: u.href };
}

/** Devuelve todos los links detectados en el texto (sin duplicados por URL). */
export function parseLinks(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s<>]+/gi);
  if (!matches) return [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const parsed = classifyUrl(raw);
    if (!seen.has(parsed.url)) {
      seen.add(parsed.url);
      out.push(parsed);
    }
  }
  return out;
}

/** Devuelve null si el texto no tiene link; si no, el primer {kind, url}. */
export function parseLink(text) {
  const links = parseLinks(text);
  return links.length ? links[0] : null;
}

// ───────────────────────── Comandos de mensaje y recorte ─────────────────────────

/** Convierte "mm:ss" o "hh:mm:ss" en segundos. Devuelve null si es inválido. */
export function parseTimestampToSeconds(ts) {
  const m = String(ts || '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 && m[1]) return null;
  if (sec >= 60) return null;
  return h * 3600 + min * 60 + sec;
}

export function formatSecondsToTimestamp(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(rem)}` : `${m}:${pad(rem)}`;
}

/** Parsea un rango de recorte tipo "0:15-0:45" o "1:00 - 1:30". */
export function parseTrimRange(text) {
  const m = String(text || '').match(/\b((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–]\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\b/);
  if (!m) return null;
  const startSec = parseTimestampToSeconds(m[1]);
  const endSec = parseTimestampToSeconds(m[2]);
  if (startSec == null || endSec == null || endSec <= startSec) return null;
  return {
    raw: `${m[1]}-${m[2]}`,
    start: formatSecondsToTimestamp(startSec),
    end: formatSecondsToTimestamp(endSec),
    startSec,
    endSec,
    durationSec: endSec - startSec,
  };
}

/**
 * Analiza un mensaje completo para detectar links, modo (video | audio | document) y recorte opcional.
 */
export function parseMessageCommand(text) {
  const links = parseLinks(text);
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s<>]+/gi, ' ');
  const trim = parseTrimRange(withoutUrls);
  let mode = 'video';
  if (/(?:^|\s)(?:!?(?:audio|mp3)|voz)(?=\s|$)/i.test(withoutUrls)) {
    mode = 'audio';
  } else if (/(?:^|\s)(?:!?(?:doc|hd|documento)|original)(?=\s|$)/i.test(withoutUrls)) {
    mode = 'document';
  }
  return { links, mode, trim };
}

/**
 * Parsea comandos administrativos enviados por chat:
 *   /allow <numero>, /remove <numero>, /limit <minutos>, /status, /help
 */
export function parseAdminCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;
  const [rawCmd, ...rest] = trimmed.split(/\s+/);
  const cmd = rawCmd.slice(1).toLowerCase();
  const arg = rest.join(' ').trim();

  if (cmd === 'allow' || cmd === 'add') {
    const phone = normalizePhone(arg);
    return { cmd: 'allow', phone, valid: phone.length >= 8 };
  }
  if (cmd === 'remove' || cmd === 'revoke' || cmd === 'del') {
    const phone = normalizePhone(arg);
    return { cmd: 'remove', phone, valid: phone.length >= 8 };
  }
  if (cmd === 'limit') {
    const minutes = Number(arg);
    return { cmd: 'limit', minutes, valid: Number.isFinite(minutes) && minutes >= 1 && minutes <= 180 };
  }
  if (cmd === 'status' || cmd === 'estado') {
    return { cmd: 'status', valid: true };
  }
  if (cmd === 'help' || cmd === 'ayuda') {
    return { cmd: 'help', valid: true };
  }
  return null;
}

// ───────────────────────── Lista blanca y grupos ─────────────────────────

/** Solo dígitos; los móviles de México pueden venir como 521XXXXXXXXXX o 52XXXXXXXXXX → unificamos a 52XXXXXXXXXX. */
export function normalizePhone(v) {
  const d = String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return /^521\d{10}$/.test(d) ? '52' + d.slice(3) : d;
}

/**
 * ¿Mensaje de un número o grupo autorizado?
 * En 1:1: el remitente debe estar en `allowed` (y `fromMe` solo vale en el chat "mensaje a mí mismo").
 * En grupos: requiere `allowGroups: true`, grupo autorizado (si `allowedGroups` tiene elementos),
 * y que el participante esté en `allowed` o el bot haya sido mencionado (`mentionedMe`).
 */
export function isAllowedSender({
  allowed,
  allowedGroups = new Set(),
  allowGroups = false,
  jids = [],
  ownId,
  fromMe = false,
  isGroup = false,
  groupJid = '',
  mentionedMe = false,
}) {
  if (isGroup) {
    if (!allowGroups) return false;
    if (allowedGroups.size > 0 && !allowedGroups.has(groupJid)) return false;
    const nums = jids.filter((j) => j && !String(j).endsWith('@lid')).map(normalizePhone);
    if (nums.some((n) => allowed.has(n))) return true;
    return Boolean(mentionedMe);
  }
  const nums = jids.filter((j) => j && !String(j).endsWith('@lid')).map(normalizePhone);
  if (!nums.some((n) => allowed.has(n))) return false;
  return fromMe ? nums.includes(normalizePhone(ownId)) : true;
}

/**
 * Registro de los mensajes que envía el propio bot para no entrar en bucle.
 */
export function createSentTracker(max = 1000) {
  const ids = new Set();
  return {
    newId() {
      const id = '3EB0' + randomBytes(14).toString('hex').toUpperCase();
      ids.add(id);
      if (ids.size > max) ids.delete(ids.values().next().value);
      return id;
    },
    has: (id) => ids.has(id),
  };
}

/**
 * Caché temporal en memoria por URL + modo + recorte para evitar descargas duplicadas.
 */
export function createResultCache(ttlMs = 15 * 60_000, maxEntries = 50) {
  const map = new Map();
  return {
    makeKey(url, mode = 'video', trimRaw = '') {
      return `${url}|${mode}|${trimRaw || ''}`;
    },
    get(key, now = Date.now()) {
      const item = map.get(key);
      if (!item) return null;
      if (now > item.expiresAt) {
        map.delete(key);
        return null;
      }
      return item.value;
    },
    set(key, value, now = Date.now()) {
      map.delete(key);
      map.set(key, { value, expiresAt: now + ttlMs });
      if (map.size > maxEntries) {
        map.delete(map.keys().next().value);
      }
    },
    clear() {
      map.clear();
    },
    size(now = Date.now()) {
      for (const [k, v] of map.entries()) {
        if (now > v.expiresAt) map.delete(k);
      }
      return map.size;
    },
  };
}

// ───────────────────────── Utilidades ─────────────────────────

const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('es-MX') : '?');

function truncate(s, max) {
  s = (s ?? '').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export function buildCaption({ title, byline, likes, platform }) {
  const platformTag = platform ? `${platform} · ` : '';
  const footer = `\n\n${platformTag}👍 ${fmtNum(likes)}`;
  const clean = (title || '').replace(/\*/g, '').trim();
  const head = [clean && (clean.includes('\n') ? clean : `*${clean}*`), byline].filter(Boolean).join('\n');
  return truncate(head, CAPTION_MAX - footer.length) + footer;
}

/** Top N comentarios raíz por likes → un solo mensaje de texto. null si no hay comentarios. */
export function buildCommentsText(comments) {
  const top = (comments || [])
    .filter((c) => c && c.text && (c.parent == null || c.parent === 'root'))
    .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
    .slice(0, TOP_COMMENTS);
  if (!top.length) return null;
  const lines = top.map(
    (c, i) =>
      `${i + 1}. *${c.author || 'anónimo'}* · 👍 ${fmtNum(c.like_count || 0)}\n${truncate(c.text.replace(/\s*\n\s*/g, ' '), COMMENT_MAX_CHARS)}`,
  );
  return `💬 *Top ${top.length} comentarios*\n\n${lines.join('\n\n')}`;
}

export function extractTopComments(comments) {
  return (comments || [])
    .filter((c) => c && c.text && (c.parent == null || c.parent === 'root'))
    .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
    .slice(0, TOP_COMMENTS)
    .map((c) => ({
      author: c.author || 'anónimo',
      likes: Number(c.like_count || 0),
      text: truncate(c.text.replace(/\s*\n\s*/g, ' '), COMMENT_MAX_CHARS),
    }));
}

async function ytdlp(args, opts = {}) {
  const base = ['--no-playlist', '--js-runtimes', 'node'];
  if (runtimeConfig.ytdlpCookies) base.push('--cookies', runtimeConfig.ytdlpCookies);
  try {
    const { stdout } = await exec(runtimeConfig.ytdlpBin, [...base, ...args], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 10 * 60_000,
      ...opts,
    });
    return stdout;
  } catch (e) {
    if (e?.code === 'ENOENT') {
      throw new UserError('yt-dlp no está instalado en este servidor (instálalo con: pip install -U "yt-dlp[default]")');
    }
    throw new UserError(explainYtdlpError(e.stderr || e.message || ''));
  }
}

class UserError extends Error {}

function explainYtdlpError(stderr) {
  const line = stderr.split('\n').reverse().find((l) => l.includes('ERROR')) || stderr.trim().split('\n').pop() || '';
  const l = line.toLowerCase();
  if (l.includes('not a bot')) return 'YouTube pide verificar que no soy bot (configura cookies.txt en el panel)';
  if (stderr.includes('429') || l.includes('429') || l.includes('too many requests')) return 'la plataforma bloqueó temporalmente las peticiones (429), intenta más tarde';
  if (l.includes('private')) return 'el contenido es privado';
  if (l.includes('sign in') || l.includes('login') || l.includes('age')) return 'requiere iniciar sesión o verificar edad';
  if (l.includes('unavailable') || l.includes('not available')) return 'el contenido no está disponible';
  if (l.includes('no video could be found')) return 'NO_VIDEO';
  return truncate(line.replace(/^ERROR:\s*/, ''), 160) || 'error desconocido de yt-dlp';
}

async function probe(file) {
  const { stdout } = await exec(runtimeConfig.ffprobeBin, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    bytes: Number(j.format.size),
    duration: Number(j.format.duration),
    vcodec: v?.codec_name,
    acodec: a?.codec_name,
    height: v?.height,
  };
}

// ───────────────────────── ffmpeg: recorte, audio y compresión ─────────────────────────

export async function trimMediaFile(src, dir, trim) {
  if (!trim) return src;
  const out = path.join(dir, 'trimmed.mp4');
  const args = [
    '-y', '-v', 'error',
    '-ss', String(trim.startSec),
    '-to', String(trim.endSec),
    '-i', src,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ];
  await exec(runtimeConfig.ffmpegBin, args, { timeout: 10 * 60_000 });
  return out;
}

export async function extractAudioFile(src, dir, trim = null) {
  const out = path.join(dir, 'audio.mp3');
  const args = [
    '-y', '-v', 'error',
    ...(trim ? ['-ss', String(trim.startSec), '-to', String(trim.endSec)] : []),
    '-i', src,
    '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2',
    out,
  ];
  await exec(runtimeConfig.ffmpegBin, args, { timeout: 10 * 60_000 });
  const stat = await fs.stat(out);
  return {
    path: out,
    bytes: stat.size,
    as: 'audio',
    kind: 'audio',
    mimetype: 'audio/mpeg',
    fileName: 'audio.mp3',
    note: trim ? `audio MP3 recortado (${trim.start}–${trim.end})` : 'audio MP3 extraído (128 kbps)',
  };
}

/**
 * Devuelve {path, bytes, as: 'video'|'document'|'none', note}.
 * Orden: original si ya cumple → comprimir (hasta 4 intentos) → documento si no cabe.
 */
export async function fitForWhatsApp(src, dir, { forceDocument = false, trim = null } = {}) {
  const maxDocBytes = runtimeConfig.maxDocMb * 1024 * 1024;
  const workingSrc = trim ? await trimMediaFile(src, dir, trim) : src;
  const trimNote = trim ? ` · recorte ${trim.start}–${trim.end}` : '';
  const info = await probe(workingSrc);

  if (forceDocument) {
    if (info.bytes <= maxDocBytes) {
      return {
        path: workingSrc,
        bytes: info.bytes,
        as: 'document',
        note: `calidad original como documento (${(info.bytes / 1048576).toFixed(1)} MB)${trimNote}`,
      };
    }
    return {
      path: null,
      bytes: info.bytes,
      as: 'none',
      note: `excede el límite de documento (${(info.bytes / 1048576).toFixed(0)} MB > ${runtimeConfig.maxDocMb} MB)`,
    };
  }

  const waOk = info.vcodec === 'h264' && (!info.acodec || info.acodec === 'aac');
  if (info.bytes <= VIDEO_TARGET && waOk) {
    return { path: workingSrc, bytes: info.bytes, as: 'video', note: `original (ya cabía)${trimNote}` };
  }

  const audioK = info.acodec ? 96 : 0;
  let videoK = Math.floor((VIDEO_TARGET * 8 * 0.95) / Math.max(info.duration || 1, 1) / 1000 - audioK);
  const MIN_VIDEO_K = 100;

  if (videoK >= MIN_VIDEO_K) {
    const out = path.join(dir, 'compressed.mp4');
    for (let attempt = 1; attempt <= 4; attempt++) {
      const h = videoK >= 1200 ? 720 : videoK >= 500 ? 480 : videoK >= 250 ? 360 : 240;
      const args = [
        '-y', '-v', 'error', '-i', workingSrc,
        '-vf', `scale=-2:'min(${h},ih)'`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-maxrate', `${videoK}k`, '-bufsize', `${videoK * 2}k`, '-pix_fmt', 'yuv420p',
        ...(info.acodec ? ['-c:a', 'aac', '-b:a', `${audioK}k`, '-ac', '2'] : ['-an']),
        '-movflags', '+faststart', out,
      ];
      try {
        await exec(runtimeConfig.ffmpegBin, args, { timeout: 15 * 60_000 });
      } catch {
        break;
      }
      const { bytes } = await probe(out);
      if (bytes <= VIDEO_TARGET) {
        return {
          path: out,
          bytes,
          as: 'video',
          note: `comprimido a ${h}p (${(info.bytes / 1048576).toFixed(1)} MB → ${(bytes / 1048576).toFixed(1)} MB, intento ${attempt})${trimNote}`,
        };
      }
      videoK = Math.floor(videoK * (VIDEO_TARGET / bytes) * 0.9);
      if (videoK < MIN_VIDEO_K) break;
    }
  }

  if (info.bytes <= maxDocBytes) {
    return { path: workingSrc, bytes: info.bytes, as: 'document', note: `no cupo como video <16 MB; va como documento${trimNote}` };
  }
  return { path: null, bytes: info.bytes, as: 'none', note: `no cupo ni como documento (${(info.bytes / 1048576).toFixed(0)} MB)` };
}

async function processDownloadedMedia(srcPath, dir, { mode = 'video', trim = null } = {}) {
  if (mode === 'audio') {
    return extractAudioFile(srcPath, dir, trim);
  }
  return fitForWhatsApp(srcPath, dir, { forceDocument: mode === 'document', trim });
}

// ───────────────────────── Handler YouTube ─────────────────────────

const YT_FORMAT =
  'bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]/bv*[height<=720]+ba/b[height<=720]/b';
const YT_AUDIO_FORMAT = 'ba[acodec^=mp4a]/ba/b';

async function handleYouTube(url, dir, _link, options = {}) {
  const { mode = 'video', trim = null } = options;
  const maxDurationS = (mode === 'audio' ? Math.max(runtimeConfig.maxDurationMin * 3, 120) : runtimeConfig.maxDurationMin) * 60;

  const stdout = await ytdlp([
    '-J', '--skip-download', '--write-comments',
    '--extractor-args', 'youtube:max_comments=200,200,0,0,0;comment_sort=top',
    url,
  ]);
  const info = JSON.parse(stdout);
  const infoFile = path.join(dir, 'info.json');
  await fs.writeFile(infoFile, stdout);

  const meta = {
    platform: 'YouTube',
    title: info.title,
    byline: info.channel || info.uploader,
    likes: info.like_count,
    duration: info.duration,
    comments: info.comments,
    notices: [],
    media: null,
  };

  if (info.is_live) {
    meta.notices.push('Es un directo; no descargo el video.');
    return meta;
  }
  if (!trim && info.duration > maxDurationS) {
    meta.notices.push(
      `El video dura ${Math.round(info.duration / 60)} min (máx. ${Math.round(maxDurationS / 60)} min en modo ${mode}); no lo descargo.`,
    );
    return meta;
  }

  const raw = path.join(dir, 'raw');
  const format = mode === 'audio' ? YT_AUDIO_FORMAT : YT_FORMAT;
  const dlArgs = ['--load-info-json', infoFile, '-f', format, '-o', `${raw}.%(ext)s`, '--no-write-comments'];
  if (mode !== 'audio') dlArgs.push('--merge-output-format', 'mp4');
  await ytdlp(dlArgs);

  const files = (await fs.readdir(dir)).filter((f) => f.startsWith('raw.'));
  if (!files.length) throw new UserError('no se descargó ningún archivo');
  meta.media = await processDownloadedMedia(path.join(dir, files[0]), dir, { mode, trim });
  return meta;
}

// ───────────────────────── Handler X (tweets) ─────────────────────────

const decodeEntities = (t) =>
  t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const xToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new UserError(`no pude bajar el archivo (HTTP ${res.status})`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return (await fs.stat(file)).size;
}

const cleanTweetText = (t) => decodeEntities((t || '').replace(/\s*https?:\/\/t\.co\/\S+/g, '')).trim();

function pickBestXVariant(video) {
  const variants = (video?.video_info?.variants || [])
    .filter((v) => v?.content_type === 'video/mp4' && v?.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (!variants.length) return null;
  // preferir calidad media/720p si existe para no bajar archivos enormes innecesarios
  const under2Mbps = variants.find((v) => (v.bitrate || 0) <= 2_200_000);
  return under2Mbps || variants[0];
}

async function xMedia(tw, url, dir, meta, options = {}) {
  const { mode = 'video', trim = null } = options;
  const maxDurationS = (mode === 'audio' ? Math.max(runtimeConfig.maxDurationMin * 3, 120) : runtimeConfig.maxDurationMin) * 60;
  const media = tw.mediaDetails || [];
  const video = media.find((m) => m.type === 'video' || m.type === 'animated_gif');
  if (video) {
    if (!trim && video.video_info?.duration_millis > maxDurationS * 1000) {
      meta.notices.push(`El video es demasiado largo (máx. ${Math.round(maxDurationS / 60)} min); no lo descargo.`);
      return true;
    }
    const raw = path.join(dir, 'raw');
    let downloadedPath = null;

    // Intento directo desde las variantes MP4 del endpoint de sindicación (funciona sin yt-dlp)
    const variant = pickBestXVariant(video);
    if (variant?.url) {
      try {
        const directFile = `${raw}.mp4`;
        await download(variant.url, directFile);
        downloadedPath = directFile;
      } catch {
        downloadedPath = null;
      }
    }

    if (!downloadedPath) {
      await ytdlp(['-f', 'b[height<=720]/bv*[height<=720]+ba/b', '--merge-output-format', 'mp4', '-o', `${raw}.%(ext)s`, url]);
      const files = (await fs.readdir(dir)).filter((f) => f.startsWith('raw.'));
      if (!files.length) throw new UserError('no se descargó ningún archivo');
      downloadedPath = path.join(dir, files[0]);
    }

    meta.media = await processDownloadedMedia(downloadedPath, dir, { mode, trim });
    return true;
  }

  const photos = media.filter((m) => m.type === 'photo');
  if (photos.length) {
    if (mode === 'audio') {
      meta.notices.push('El tweet solo contiene imágenes; no hay pista de audio que extraer.');
    }
    const saved = [];
    for (const [i, p] of photos.entries()) {
      const file = path.join(dir, `photo${i}.jpg`);
      saved.push({ path: file, bytes: await download(`${p.media_url_https}?name=large`, file) });
    }
    meta.media = {
      as: 'image',
      kind: 'image',
      ...saved[0],
      note: `foto 1/${saved.length}`,
      mimetype: 'image/jpeg',
      fileName: 'photo.jpg',
    };
    meta.moreImages = saved.slice(1);
    return true;
  }
  return false;
}

async function handleX(url, dir, link, options = {}) {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${link.id}&token=${xToken(link.id)}`);
  if (!res.ok) throw new UserError('el tweet no está disponible');
  const t = await res.json();
  if (t.__typename !== 'Tweet') {
    throw new UserError('el tweet no está disponible (borrado, privado o con restricción de edad)');
  }

  const meta = {
    platform: 'X',
    title: cleanTweetText(t.text),
    byline: t.user ? `${t.user.name} (@${t.user.screen_name})` : undefined,
    likes: t.favorite_count,
    comments: null,
    notices: [],
    media: null,
  };
  meta.commentsNote = `X no permite leer respuestas sin sesión iniciada (el tweet tiene ${fmtNum(t.conversation_count)} respuestas).`;

  let found = await xMedia(t, url, dir, meta, options);
  if (!found && t.quoted_tweet?.mediaDetails?.length) {
    const q = t.quoted_tweet;
    const qUrl = `https://x.com/${q.user?.screen_name || 'i'}/status/${q.id_str}`;
    found = await xMedia(q, qUrl, dir, meta, options);
    if (found) {
      meta.notices.push(`↪️ Media del tweet citado de @${q.user?.screen_name}: ${truncate(cleanTweetText(q.text), 200)}`);
    }
  }
  if (!found) meta.notices.push('El tweet no trae video ni foto.');
  return meta;
}

// ───────────────────────── Handler Instagram / TikTok / Reddit ─────────────────────────

const PLATFORM_LABELS = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  reddit: 'Reddit',
};

async function handleGenericYtdlp(url, dir, link, options = {}) {
  const { mode = 'video', trim = null } = options;
  const maxDurationS = (mode === 'audio' ? Math.max(runtimeConfig.maxDurationMin * 3, 120) : runtimeConfig.maxDurationMin) * 60;

  const stdout = await ytdlp(['-J', '--skip-download', url]);
  const info = JSON.parse(stdout);
  const infoFile = path.join(dir, 'info.json');
  await fs.writeFile(infoFile, stdout);

  const meta = {
    platform: PLATFORM_LABELS[link.kind] || link.kind,
    title: info.title || info.description || 'Publicación',
    byline: info.uploader || info.channel || info.creator,
    likes: info.like_count,
    duration: info.duration,
    comments: info.comments || null,
    notices: [],
    media: null,
  };

  if (!trim && info.duration && info.duration > maxDurationS) {
    meta.notices.push(`El video dura ${Math.round(info.duration / 60)} min (máx. ${Math.round(maxDurationS / 60)} min); no lo descargo.`);
    return meta;
  }

  const raw = path.join(dir, 'raw');
  const format = mode === 'audio' ? 'ba/b' : 'bv*[height<=720]+ba/b[height<=720]/b';
  const dlArgs = ['--load-info-json', infoFile, '-f', format, '-o', `${raw}.%(ext)s`];
  if (mode !== 'audio') dlArgs.push('--merge-output-format', 'mp4');
  await ytdlp(dlArgs);

  const files = (await fs.readdir(dir)).filter((f) => f.startsWith('raw.'));
  if (!files.length) throw new UserError('no se descargó ningún archivo');
  meta.media = await processDownloadedMedia(path.join(dir, files[0]), dir, { mode, trim });
  return meta;
}

// ───────────────────────── Orquestación ─────────────────────────

/**
 * Procesa un texto con link y devuelve la lista de respuestas a enviar.
 * Compatible con `buildReplies(text, dir)` y con `buildReplies(text, dir, { mode, trim, linkOverride })`.
 */
export async function buildReplies(text, dir, options = {}) {
  const cmd = parseMessageCommand(text);
  const link = options.linkOverride || cmd.links[0] || parseLink(text);
  const mode = options.mode || cmd.mode || 'video';
  const trim = options.trim !== undefined ? options.trim : cmd.trim;

  if (!link) return [];
  if (link.kind === 'unsupported') {
    return [
      {
        type: 'text',
        text: '🤷 Link no soportado. Plataformas compatibles: YouTube, X (tweets), Instagram, TikTok y Reddit.',
      },
    ];
  }

  await fs.mkdir(dir, { recursive: true });
  let meta;
  try {
    meta = await HANDLERS[link.kind](link.url, dir, link, { mode, trim });
  } catch (e) {
    const msg = e instanceof UserError ? e.message : `error inesperado: ${truncate(String(e.message || e), 140)}`;
    return [{ type: 'text', text: `⚠️ No pude procesar el link (${link.kind}): ${msg}.` }];
  }

  const replies = [];
  const caption = buildCaption(meta);
  const m = meta.media;
  if (m && m.as !== 'none') {
    const replyType = m.as === 'document' ? 'document' : m.as === 'audio' ? 'audio' : m.kind || 'video';
    const ext = replyType === 'audio' ? 'mp3' : replyType === 'image' ? 'jpg' : 'mp4';
    replies.push({
      type: replyType,
      path: m.path,
      bytes: m.bytes,
      note: m.note,
      caption,
      fileName: m.fileName || `${link.kind}-${path.basename(dir)}.${ext}`,
      mimetype: m.mimetype || (replyType === 'audio' ? 'audio/mpeg' : 'video/mp4'),
      meta: {
        platform: meta.platform,
        title: meta.title,
        byline: meta.byline,
        likes: meta.likes,
      },
    });
  } else {
    replies.push({
      type: 'text',
      text: caption,
      meta: {
        platform: meta.platform,
        title: meta.title,
        byline: meta.byline,
        likes: meta.likes,
      },
    });
    if (m?.note) meta.notices.push(m.note);
  }

  for (const [i, im] of (meta.moreImages || []).entries()) {
    replies.push({
      type: 'image',
      path: im.path,
      bytes: im.bytes,
      note: `foto ${i + 2}/${meta.moreImages.length + 1}`,
      caption: '',
      fileName: `photo${i + 2}.jpg`,
      mimetype: 'image/jpeg',
    });
  }

  for (const n of meta.notices) {
    replies.push({ type: 'text', text: `ℹ️ ${n}` });
  }

  const topComments = extractTopComments(meta.comments);
  replies.push({
    type: 'text',
    text:
      buildCommentsText(meta.comments) ??
      `💬 Sin comentarios disponibles.${meta.commentsNote ? ' ' + meta.commentsNote : ''}`,
    comments: topComments,
  });

  return replies;
}

const HANDLERS = {
  youtube: handleYouTube,
  x: handleX,
  instagram: handleGenericYtdlp,
  tiktok: handleGenericYtdlp,
  reddit: handleGenericYtdlp,
};

export { UserError, ytdlp, fmtNum, truncate, probe };
