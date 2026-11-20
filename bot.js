// bot.js — CLI del bot personal de WhatsApp (Baileys).
//   node bot.js                      → conecta (QR la primera vez) y responde a links
//   node bot.js --dry-run <texto...> → imprime lo que enviaría, sin abrir WhatsApp
import './env.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReplies,
  parseMessageCommand,
  parseAdminCommand,
  normalizePhone,
  isAllowedSender,
  createSentTracker,
  createResultCache,
  getRuntimeConfig,
  updateRuntimeConfig,
} from './lib.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// ───────────────────────── --dry-run ─────────────────────────
if (args.includes('--dry-run')) {
  const inputs = args.filter((a) => a !== '--dry-run');
  if (!inputs.length) {
    console.error('Uso: node bot.js --dry-run "<texto o link>" [...]');
    process.exit(1);
  }
  for (const [i, input] of inputs.entries()) {
    const dir = path.join(ROOT, 'out', `${Date.now()}-${i}`);
    console.log(`\n════════ DRY-RUN: ${input}`);
    const cmd = parseMessageCommand(input);
    const links = cmd.links.length ? cmd.links : [null];
    for (const [li, link] of links.entries()) {
      const subDir = links.length > 1 ? path.join(dir, `link-${li}`) : dir;
      const replies = await buildReplies(input, subDir, { linkOverride: link, mode: cmd.mode, trim: cmd.trim });
      if (!replies.length) console.log('(sin link: el bot no respondería nada)');
      for (const [n, r] of replies.entries()) {
        console.log(`\n── mensaje ${n + 1}/${replies.length} → ${r.type.toUpperCase()}`);
        if (r.type === 'text') {
          console.log(r.text);
        } else {
          console.log(`archivo : ${r.path}`);
          console.log(`tamaño  : ${(r.bytes / 1048576).toFixed(2)} MB (${r.bytes} bytes)`);
          console.log(`nota    : ${r.note}`);
          console.log(`pie (${(r.caption || '').length}/1024 chars):\n${r.caption || ''}`);
        }
      }
    }
  }
  process.exit(0);
}

// ───────────────────────── Modo real ─────────────────────────
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, normalizeMessageContent } =
  await import('@whiskeysockets/baileys');
const { default: pino } = await import('pino');
const { default: qrcode } = await import('qrcode-terminal');

const allowed = new Set((process.env.ALLOWED_NUMBERS || '').split(',').map(normalizePhone).filter(Boolean));
const allowedGroups = new Set((process.env.ALLOWED_GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean));
const allowGroups = String(process.env.ALLOW_GROUPS || 'false').toLowerCase() === 'true';

if (!allowed.size) {
  console.error('Falta ALLOWED_NUMBERS en .env (copia .env.example). Sin lista blanca el bot no arranca.');
  process.exit(1);
}

const AUTH_DIR = path.join(ROOT, 'auth');
const sent = createSentTracker();
const cache = createResultCache();
const send = (sock, jid, content, opts = {}) => sock.sendMessage(jid, content, { ...opts, messageId: sent.newId() });

let queue = Promise.resolve();

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nEscanea este QR desde WhatsApp (número secundario) → Dispositivos vinculados:\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log(`✅ Conectado como ${normalizePhone(sock.user?.id)}. Whitelist: ${[...allowed].join(', ')}`);
      if (allowed.has(normalizePhone(sock.user?.id))) {
        console.log('ℹ️ Modo un solo número: escríbete a ti mismo (chat "Message yourself") para usar el bot.');
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('Sesión cerrada desde el teléfono. Borra ./auth y vuelve a escanear el QR.');
        process.exit(1);
      }
      console.log(`Conexión cerrada (${code}); reconectando…`);
      setTimeout(start, 3000);
    }
  });

  async function isAuthorized(msg, content) {
    const jid = msg.key.remoteJid;
    if (!jid || jid === 'status@broadcast') return false;
    const isGroup = jid.endsWith('@g.us');
    const senderJid = isGroup ? msg.key.participant || msg.participant : jid;
    const jids = [senderJid, msg.key.remoteJidAlt].filter(Boolean);
    if (senderJid?.endsWith('@lid')) {
      try {
        jids.push(await sock.signalRepository?.lidMapping?.getPNForLID?.(senderJid));
      } catch {
        /* sin mapeo */
      }
    }
    const ownPhone = normalizePhone(sock.user?.id);
    const mentioned = content?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const mentionedMe = mentioned.some((m) => normalizePhone(m) === ownPhone);
    return isAllowedSender({
      allowed,
      allowedGroups,
      allowGroups,
      jids,
      ownId: sock.user?.id,
      fromMe: !!msg.key.fromMe,
      isGroup,
      groupJid: isGroup ? jid : '',
      mentionedMe,
    });
  }

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (sent.has(msg.key.id)) continue;
      queue = queue.then(() => handle(sock, msg, isAuthorized, normalizeMessageContent)).catch((e) => console.error('handle:', e));
    }
  });
}

async function handle(sock, msg, isAuthorized, normalize) {
  const content = normalize(msg.message);
  const text =
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption;
  if (!text) return;

  const admin = parseAdminCommand(text);
  const cmd = parseMessageCommand(text);
  if (!admin && !cmd.links.length) return;
  if (!(await isAuthorized(msg, content))) return;

  const jid = msg.key.remoteJid;

  if (admin) {
    if (admin.cmd === 'allow' && admin.valid) {
      allowed.add(admin.phone);
      await send(sock, jid, { text: `✅ Número autorizado: ${admin.phone}` }, { quoted: msg });
    } else if (admin.cmd === 'remove' && admin.valid) {
      allowed.delete(admin.phone);
      await send(sock, jid, { text: `🗑️ Número eliminado de la lista blanca: ${admin.phone}` }, { quoted: msg });
    } else if (admin.cmd === 'limit' && admin.valid) {
      updateRuntimeConfig({ maxDurationMin: admin.minutes });
      await send(sock, jid, { text: `⏱️ Límite de duración actualizado a ${admin.minutes} min.` }, { quoted: msg });
    } else if (admin.cmd === 'status') {
      const cfg = getRuntimeConfig();
      await send(
        sock,
        jid,
        {
          text: `🤖 *Estado del Bot*\nWhitelist: ${allowed.size} número(s)\nLímite video: ${cfg.maxDurationMin} min\nLímite doc: ${cfg.maxDocMb} MB\nCaché: ${cache.size()} entrada(s)`,
        },
        { quoted: msg },
      );
    } else {
      await send(
        sock,
        jid,
        {
          text:
            '📖 *Comandos disponibles*\n• `<link>` — video comprimido (<16 MB)\n• `audio <link>` — solo audio MP3\n• `doc <link>` — documento calidad original\n• `0:15-0:45 <link>` — recorte con FFmpeg\n• `/allow <número>` · `/remove <número>` · `/limit <min>` · `/status`',
        },
        { quoted: msg },
      );
    }
    return;
  }

  const react = (emoji) => send(sock, jid, { react: { text: emoji, key: msg.key } }).catch(() => {});
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wabot-'));
  try {
    await react('⏳');
    for (const [idx, link] of cmd.links.entries()) {
      const subDir = path.join(dir, `l-${idx}`);
      const replies = await buildReplies(text, subDir, { linkOverride: link, mode: cmd.mode, trim: cmd.trim });
      for (const r of replies) {
        if (r.type === 'text') await send(sock, jid, { text: r.text }, { quoted: msg });
        else if (r.type === 'video')
          await send(sock, jid, { video: { url: r.path }, mimetype: 'video/mp4', caption: r.caption }, { quoted: msg });
        else if (r.type === 'audio')
          await send(sock, jid, { audio: { url: r.path }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
        else if (r.type === 'image')
          await send(sock, jid, { image: { url: r.path }, ...(r.caption ? { caption: r.caption } : {}) }, { quoted: msg });
        else if (r.type === 'document')
          await send(sock, jid, { document: { url: r.path }, mimetype: r.mimetype, fileName: r.fileName, caption: r.caption }, { quoted: msg });
      }
    }
    await react('✅');
  } catch (e) {
    console.error('envío falló:', e);
    await react('❌');
    await send(sock, jid, { text: '⚠️ Falló el envío por WhatsApp.' }, { quoted: msg }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

start();
