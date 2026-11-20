// lib.js — lógica del bot sin WhatsApp: detectar link, yt-dlp, ffmpeg, formateo.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';

export const WA_VIDEO_LIMIT = 16 * 1024 * 1024; // límite práctico de WhatsApp para video
const VIDEO_TARGET = Math.floor(WA_VIDEO_LIMIT * 0.92); // margen de seguridad (~14.7 MB)
const MAX_DOC_BYTES = Number(process.env.MAX_DOC_MB || 100) * 1024 * 1024;
const MAX_DURATION_S = Number(process.env.MAX_DURATION_MIN || 20) * 60;
const CAPTION_MAX = 1024;
const TOP_COMMENTS = 5;
const COMMENT_MAX_CHARS = 300;

// ───────────────────────── Detección de links ─────────────────────────

/** Devuelve null si el texto no tiene link; si no, {kind, url}. kind: youtube | x | unsupported */
export function parseLink(text) {
  const m = text?.match(/https?:\/\/[^\s<>]+/i);
  if (!m) return null;
  let u;
  try {
    u = new URL(m[0].replace(/[).,;!?]+$/, ''));
  } catch {
    return { kind: 'unsupported', url: m[0] };
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|music)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' && parts[0]) {
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${parts[0]}` };
  }
  if (host === 'youtube.com') {
    if (parts[0] === 'watch' && u.searchParams.get('v')) {
      return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${u.searchParams.get('v')}` };
    }
    if (['shorts', 'live', 'embed'].includes(parts[0]) && parts[1]) {
      return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${parts[1]}` };
    }
  }
  if (['x.com', 'twitter.com'].includes(host)) {
    const i = parts.indexOf('status');
    if (i >= 0 && /^\d+$/.test(parts[i + 1] || '')) {
      return { kind: 'x', url: `https://x.com/${parts[0] === 'i' ? 'i' : parts[0]}/status/${parts[i + 1]}`, id: parts[i + 1] };
    }
  }
  return { kind: 'unsupported', url: u.href };
}

// ───────────────────────── Lista blanca ─────────────────────────

/** Solo dígitos; los móviles de México pueden venir como 521XXXXXXXXXX o 52XXXXXXXXXX → unificamos a 52XXXXXXXXXX. */
export function normalizePhone(v) {
  const d = String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return /^521\d{10}$/.test(d) ? '52' + d.slice(3) : d;
}

/**
 * ¿Mensaje de un número autorizado? `jids` son todas las identidades conocidas del remitente
 * (remoteJid, remoteJidAlt, número resuelto desde LID). Los mensajes fromMe solo valen en el chat
 * "mensaje a mí mismo" (si no, serían las respuestas del propio bot).
 */
export function isAllowedSender({ allowed, jids, ownId, fromMe }) {
  const nums = jids.filter((j) => j && !String(j).endsWith('@lid')).map(normalizePhone);
  if (!nums.some((n) => allowed.has(n))) return false;
  return fromMe ? nums.includes(normalizePhone(ownId)) : true;
}

// ───────────────────────── Utilidades ─────────────────────────

const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('es-MX') : '?');

function truncate(s, max) {
  s = (s ?? '').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export function buildCaption({ title, byline, likes }) {
  const footer = `\n\n👍 ${fmtNum(likes)}`;
  // negrita solo si el título es de una línea (WhatsApp no aplica *…* a través de saltos de línea)
  const clean = (title || '').replace(/\*/g, '').trim();
  const head = [clean && (clean.includes('\n') ? clean : `*${clean}*`), byline].filter(Boolean).join('\n');
  // el pie de foto manda: recortamos el texto, nunca los likes
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

async function ytdlp(args, opts = {}) {
  const base = ['--no-playlist', '--js-runtimes', 'node'];
  if (process.env.YTDLP_COOKIES) base.push('--cookies', process.env.YTDLP_COOKIES); // opcional: cookies.txt de tu navegador
  try {
    const { stdout } = await exec(YTDLP, [...base, ...args], { maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000, ...opts });
    return stdout;
  } catch (e) {
    throw new UserError(explainYtdlpError(e.stderr || e.message || ''));
  }
}

class UserError extends Error {}

function explainYtdlpError(stderr) {
  const line = stderr.split('\n').reverse().find((l) => l.includes('ERROR')) || stderr.trim().split('\n').pop() || '';
  const l = line.toLowerCase();
  if (l.includes('not a bot')) return 'YouTube pide verificar que no soy bot (usa YTDLP_COOKIES con un cookies.txt)';
  if (stderr.includes('429') || l.includes('429') || l.includes('too many requests')) return 'la plataforma me bloqueó temporalmente (429), intenta más tarde';
  if (l.includes('private')) return 'el video es privado';
  if (l.includes('sign in') || l.includes('age')) return 'requiere iniciar sesión / verificar edad';
  if (l.includes('unavailable') || l.includes('not available')) return 'el contenido no está disponible';
  if (l.includes('no video could be found')) return 'NO_VIDEO';
  return truncate(line.replace(/^ERROR:\s*/, ''), 160) || 'error desconocido de yt-dlp';
}

async function probe(file) {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
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

// ───────────────────────── ffmpeg: que quepa en WhatsApp ─────────────────────────

/**
 * Devuelve {path, bytes, as: 'video'|'document', note}.
 * Orden: original si ya cumple → comprimir (hasta 4 intentos) → documento si no cabe.
 */
export async function fitForWhatsApp(src, dir) {
  const info = await probe(src);
  const waOk = info.vcodec === 'h264' && (!info.acodec || info.acodec === 'aac');
  if (info.bytes <= VIDEO_TARGET && waOk) {
    return { path: src, bytes: info.bytes, as: 'video', note: 'original (ya cabía)' };
  }

  const audioK = info.acodec ? 96 : 0;
  // bitrate de video que cabe en el presupuesto (con 5% de holgura para el contenedor)
  let videoK = Math.floor((VIDEO_TARGET * 8 * 0.95) / info.duration / 1000 - audioK);
  const MIN_VIDEO_K = 100;

  if (videoK >= MIN_VIDEO_K) {
    const out = path.join(dir, 'compressed.mp4');
    for (let attempt = 1; attempt <= 4; attempt++) {
      const h = videoK >= 1200 ? 720 : videoK >= 500 ? 480 : videoK >= 250 ? 360 : 240;
      const args = [
        '-y', '-v', 'error', '-i', src,
        '-vf', `scale=-2:'min(${h},ih)'`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-maxrate', `${videoK}k`, '-bufsize', `${videoK * 2}k`, '-pix_fmt', 'yuv420p',
        ...(info.acodec ? ['-c:a', 'aac', '-b:a', `${audioK}k`, '-ac', '2'] : ['-an']),
        '-movflags', '+faststart', out,
      ];
      try {
        await exec(FFMPEG, args, { timeout: 15 * 60_000 });
      } catch {
        break; // ffmpeg falló: caemos al documento
      }
      const { bytes } = await probe(out);
      if (bytes <= VIDEO_TARGET) {
        return { path: out, bytes, as: 'video', note: `comprimido a ${h}p (${(info.bytes / 1048576).toFixed(1)} MB → ${(bytes / 1048576).toFixed(1)} MB, intento ${attempt})` };
      }
      videoK = Math.floor(videoK * (VIDEO_TARGET / bytes) * 0.9); // bajar y reintentar
      if (videoK < MIN_VIDEO_K) break;
    }
  }

  if (info.bytes <= MAX_DOC_BYTES) {
    return { path: src, bytes: info.bytes, as: 'document', note: 'no cupo como video <16 MB; va como documento' };
  }
  return { path: null, bytes: info.bytes, as: 'none', note: `no cupo ni como documento (${(info.bytes / 1048576).toFixed(0)} MB)` };
}

// ───────────────────────── Handler YouTube ─────────────────────────

const YT_FORMAT =
  'bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]/bv*[height<=720]+ba/b[height<=720]/b';

async function handleYouTube(url, dir) {
  // 1) metadatos + comentarios (sin descargar el video)
  const stdout = await ytdlp([
    '-J', '--skip-download', '--write-comments',
    '--extractor-args', 'youtube:max_comments=200,200,0,0,0;comment_sort=top',
    url,
  ]);
  const info = JSON.parse(stdout);
  const infoFile = path.join(dir, 'info.json');
  await fs.writeFile(infoFile, stdout);

  const meta = {
    title: info.title,
    byline: info.channel || info.uploader,
    likes: info.like_count,
    comments: info.comments,
    notices: [],
    media: null,
  };

  // 2) video
  if (info.is_live) {
    meta.notices.push('Es un directo; no descargo el video.');
    return meta;
  }
  if (info.duration > MAX_DURATION_S) {
    meta.notices.push(`El video dura ${Math.round(info.duration / 60)} min (máx. ${MAX_DURATION_S / 60}); no lo descargo.`);
    return meta;
  }
  const raw = path.join(dir, 'raw');
  await ytdlp(['--load-info-json', infoFile, '-f', YT_FORMAT, '--merge-output-format', 'mp4', '-o', `${raw}.%(ext)s`, '--no-write-comments']);
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith('raw.'));
  if (!files.length) throw new UserError('no se descargó ningún archivo');
  meta.media = await fitForWhatsApp(path.join(dir, files[0]), dir);
  return meta;
}


// ───────────────────────── Handler X (tweets) ─────────────────────────

const decodeEntities = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const xToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new UserError(`no pude bajar la imagen (HTTP ${res.status})`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return (await fs.stat(file)).size;
}

// quita los links t.co (X los agrega al final para media y enlaces)
const cleanTweetText = (t) => decodeEntities((t || '').replace(/\s*https?:\/\/t\.co\/\S+/g, '')).trim();

/** Descarga el video/fotos de un tweet (objeto de sindicación) en `meta`. Devuelve true si había media. */
async function xMedia(tw, url, dir, meta) {
  const media = tw.mediaDetails || [];
  const video = media.find((m) => m.type === 'video' || m.type === 'animated_gif');
  if (video) {
    if (video.video_info?.duration_millis > MAX_DURATION_S * 1000) {
      meta.notices.push(`El video es demasiado largo (máx. ${MAX_DURATION_S / 60} min); no lo descargo.`);
      return true;
    }
    const raw = path.join(dir, 'raw');
    await ytdlp(['-f', 'b[height<=720]/bv*[height<=720]+ba/b', '--merge-output-format', 'mp4', '-o', `${raw}.%(ext)s`, url]);
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('raw.'));
    if (!files.length) throw new UserError('no se descargó ningún archivo');
    meta.media = await fitForWhatsApp(path.join(dir, files[0]), dir);
    return true;
  }
  const photos = media.filter((m) => m.type === 'photo');
  if (photos.length) {
    const saved = [];
    for (const [i, p] of photos.entries()) {
      const file = path.join(dir, `photo${i}.jpg`);
      saved.push({ path: file, bytes: await download(`${p.media_url_https}?name=large`, file) });
    }
    meta.media = { as: 'image', kind: 'image', ...saved[0], note: `foto 1/${saved.length}`, mimetype: 'image/jpeg', fileName: 'photo.jpg' };
    meta.moreImages = saved.slice(1);
    return true;
  }
  return false;
}

async function handleX(url, dir, link) {
  // metadatos (texto, likes, tipo de media) desde el endpoint público de embeds
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${link.id}&token=${xToken(link.id)}`);
  if (!res.ok) throw new UserError('el tweet no está disponible');
  const t = await res.json();
  if (t.__typename !== 'Tweet') throw new UserError('el tweet no está disponible (borrado, privado o con restricción de edad)');

  const meta = {
    title: cleanTweetText(t.text),
    byline: t.user ? `${t.user.name} (@${t.user.screen_name})` : undefined,
    likes: t.favorite_count,
    comments: null,
    notices: [],
    media: null,
  };
  // las respuestas de X exigen sesión iniciada; sin ella no hay forma fiable de leerlas
  meta.commentsNote = `X no deja leer comentarios sin iniciar sesión (el tweet tiene ${fmtNum(t.conversation_count)} respuestas).`;

  let found = await xMedia(t, url, dir, meta);
  if (!found && t.quoted_tweet?.mediaDetails?.length) {
    // tweet que cita a otro: el video/foto está en el tweet citado
    const q = t.quoted_tweet;
    const qUrl = `https://x.com/${q.user?.screen_name || 'i'}/status/${q.id_str}`;
    found = await xMedia(q, qUrl, dir, meta);
    if (found) meta.notices.push(`↪️ Media del tweet citado de @${q.user?.screen_name}: ${truncate(cleanTweetText(q.text), 200)}`);
  }
  if (!found) meta.notices.push('El tweet no trae video ni foto.');
  return meta;
}

// ───────────────────────── Orquestación ─────────────────────────

/**
 * Procesa un texto con link y devuelve la lista de respuestas a enviar:
 *   {type:'text', text} | {type:'video'|'document'|'image', path, caption, fileName, mimetype, bytes, note}
 * `dir` es un directorio de trabajo exclusivo para esta petición.
 */
export async function buildReplies(text, dir) {
  const link = parseLink(text);
  if (!link) return [];
  if (link.kind === 'unsupported') {
    return [{ type: 'text', text: '🤷 Link no soportado. Solo YouTube y X (tweets).' }];
  }
  await fs.mkdir(dir, { recursive: true });
  let meta;
  try {
    meta = await HANDLERS[link.kind](link.url, dir, link);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : `error inesperado: ${truncate(String(e.message || e), 120)}`;
    return [{ type: 'text', text: `⚠️ No pude procesar el link: ${msg}.` }];
  }

  const replies = [];
  const caption = buildCaption(meta);
  const m = meta.media;
  if (m && m.as !== 'none') {
    replies.push({
      type: m.as === 'document' ? 'document' : m.kind || 'video',
      path: m.path,
      bytes: m.bytes,
      note: m.note,
      caption,
      fileName: m.fileName || `${link.kind}-${path.basename(dir)}.mp4`,
      mimetype: m.mimetype || 'video/mp4',
    });
  } else {
    // sin media: el texto/likes igual se mandan
    replies.push({ type: 'text', text: caption });
    if (m?.note) meta.notices.push(m.note);
  }
  for (const [i, im] of (meta.moreImages || []).entries()) {
    replies.push({ type: 'image', path: im.path, bytes: im.bytes, note: `foto ${i + 2}/${meta.moreImages.length + 1}`, caption: '', fileName: `photo${i + 2}.jpg`, mimetype: 'image/jpeg' });
  }
  for (const n of meta.notices) replies.push({ type: 'text', text: `ℹ️ ${n}` });

  replies.push({ type: 'text', text: buildCommentsText(meta.comments) ?? `💬 Sin comentarios disponibles.${meta.commentsNote ? ' ' + meta.commentsNote : ''}` });
  return replies;
}

const HANDLERS = { youtube: handleYouTube, x: handleX };
export { UserError, ytdlp, fmtNum, truncate, probe };
