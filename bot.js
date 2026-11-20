// bot.js — bot personal de WhatsApp (Baileys).
//   node bot.js                      → conecta (QR la primera vez) y responde a links
//   node bot.js --dry-run <link...>  → imprime lo que enviaría, sin abrir WhatsApp
import './env.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplies, parseLink, normalizePhone, isAllowedSender, createSentTracker } from './lib.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// ───────────────────────── --dry-run ─────────────────────────
if (args.includes('--dry-run')) {
  const inputs = args.filter((a) => a !== '--dry-run');
  if (!inputs.length) {
    console.error('Uso: node bot.js --dry-run <link> [<link> ...]');
    process.exit(1);
  }
  for (const [i, input] of inputs.entries()) {
    const dir = path.join(ROOT, 'out', `${Date.now()}-${i}`);
    console.log(`\n════════ DRY-RUN: ${input}`);
    const replies = await buildReplies(input, dir);
    if (!replies.length) console.log('(sin link: el bot no respondería nada)');
    for (const [n, r] of replies.entries()) {
      console.log(`\n── mensaje ${n + 1}/${replies.length} → ${r.type.toUpperCase()}`);
      if (r.type === 'text') {
        console.log(r.text);
      } else {
        console.log(`archivo : ${r.path}`);
        console.log(`tamaño  : ${(r.bytes / 1048576).toFixed(2)} MB (${r.bytes} bytes)`);
        console.log(`nota    : ${r.note}`);
        console.log(`pie (${r.caption.length}/1024 chars):\n${r.caption}`);
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
if (!allowed.size) {
  console.error('Falta ALLOWED_NUMBERS en .env (copia .env.example). Sin lista blanca el bot no arranca.');
  process.exit(1);
}

const AUTH_DIR = path.join(ROOT, 'auth');
const digits = normalizePhone;

const sent = createSentTracker();
/** sendMessage que marca el ID del mensaje como propio, para no procesar nuestras propias respuestas. */
const send = (sock, jid, content, opts = {}) => sock.sendMessage(jid, content, { ...opts, messageId: sent.newId() });

let queue = Promise.resolve(); // una petición a la vez: evita rate limits y saturar ffmpeg

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), syncFullHistory: false, markOnlineOnConnect: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nEscanea este QR desde WhatsApp (número secundario) → Dispositivos vinculados:\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log(`✅ Conectado como ${digits(sock.user?.id)}. Whitelist: ${[...allowed].join(', ')}`);
      if (allowed.has(digits(sock.user?.id))) console.log('ℹ️ Modo un solo número: escríbete a ti mismo (chat "Message yourself") para usar el bot.');
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

  /** ¿Este mensaje viene de un número autorizado, en un chat 1:1? */
  async function isAuthorized(msg) {
    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return false;
    const jids = [jid, msg.key.remoteJidAlt];
    if (jid.endsWith('@lid')) {
      try { jids.push(await sock.signalRepository?.lidMapping?.getPNForLID?.(jid)); } catch { /* sin mapeo */ }
    }
    const ok = isAllowedSender({ allowed, jids, ownId: sock.user?.id, fromMe: !!msg.key.fromMe });
    if (!ok && !msg.key.fromMe) console.log(`ignorado (no está en ALLOWED_NUMBERS): ${jid}${msg.key.remoteJidAlt ? ' / ' + msg.key.remoteJidAlt : ''}`);
    return ok;
  }

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (sent.has(msg.key.id)) continue; // respuesta del propio bot
      queue = queue.then(() => handle(sock, msg, isAuthorized, normalizeMessageContent)).catch((e) => console.error('handle:', e));
    }
  });
}

async function handle(sock, msg, isAuthorized, normalize) {
  const content = normalize(msg.message);
  const text = content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption;
  if (!text || !parseLink(text)) return;
  if (!(await isAuthorized(msg))) return; // lista blanca: silencio total para el resto

  const jid = msg.key.remoteJid;
  const react = (emoji) => send(sock, jid, { react: { text: emoji, key: msg.key } }).catch(() => {});
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wabot-'));
  try {
    await react('⏳');
    const replies = await buildReplies(text, dir);
    for (const r of replies) {
      if (r.type === 'text') await send(sock, jid, { text: r.text }, { quoted: msg });
      else if (r.type === 'video') await send(sock, jid, { video: { url: r.path }, mimetype: 'video/mp4', caption: r.caption }, { quoted: msg });
      else if (r.type === 'image') await send(sock, jid, { image: { url: r.path }, ...(r.caption ? { caption: r.caption } : {}) }, { quoted: msg });
      else if (r.type === 'document') await send(sock, jid, { document: { url: r.path }, mimetype: r.mimetype, fileName: r.fileName, caption: r.caption }, { quoted: msg });
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
