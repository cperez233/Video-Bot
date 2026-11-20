import './env.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import {
  buildReplies,
  createResultCache,
  createSentTracker,
  getRuntimeConfig,
  isAllowedSender,
  normalizePhone,
  parseAdminCommand,
  parseMessageCommand,
  parseTrimRange,
  updateRuntimeConfig,
} from './lib.js';
import type { ExtractMode, ParsedLink, ReplyItem } from './lib.js';

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(ROOT, 'auth');
const CONFIG_FILE = path.join(ROOT, '.bot-config.json');
const COOKIES_FILE = path.join(ROOT, '.cookies.txt');
export const WEB_JOBS_DIR = path.join(ROOT, 'out', 'web-jobs');

export type BotConnectionState = 'disconnected' | 'connecting' | 'qr' | 'pairing' | 'connected' | 'error';

export interface StoredBotConfig {
  allowedNumbers: string[];
  allowedGroups: string[];
  allowGroups: boolean;
  maxDurationMin: number;
  maxDocMb: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  source: 'web' | 'whatsapp';
  sender: string;
  platform: string;
  url: string;
  mode: ExtractMode;
  trim: string | null;
  status: 'ok' | 'error' | 'ignored' | 'cached';
  summary: string;
  bytes: number;
  durationMs: number;
}

export interface WebExtractReply {
  type: ReplyItem['type'];
  text?: string;
  caption?: string;
  note?: string;
  bytes?: number;
  fileName?: string;
  mimetype?: string;
  mediaUrl?: string;
  downloadUrl?: string;
  meta?: ReplyItem['meta'];
  comments?: ReplyItem['comments'];
}

export interface WebExtractResult {
  jobId: string;
  link: ParsedLink;
  mode: ExtractMode;
  trim: string | null;
  cached: boolean;
  durationMs: number;
  replies: WebExtractReply[];
}

interface CachedWebEntry {
  jobId: string;
  dir: string;
  result: WebExtractResult;
}

export interface EnvCapabilities {
  node: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
  hasAuthSession: boolean;
}

async function checkBinary(bin: string, arg = '-version'): Promise<boolean> {
  try {
    await exec(bin, [arg], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class BotManager {
  private state: BotConnectionState = 'disconnected';
  private qrRaw: string | null = null;
  private qrDataUrl: string | null = null;
  private pairingCode: string | null = null;
  private pairingPhone: string | null = null;
  private connectedPhone: string | null = null;
  private connectedName: string | null = null;
  private lastError: string | null = null;
  private connectedSince: string | null = null;
  private queueDepth = 0;
  private logs: Array<{ time: string; level: 'info' | 'warn' | 'error'; message: string }> = [];
  private activity: ActivityEntry[] = [];

  private allowed = new Set<string>();
  private allowedGroups = new Set<string>();
  private allowGroups = false;
  private hasCookiesFile = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sock: any = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;
  private queue: Promise<void> = Promise.resolve();
  private sent = createSentTracker();
  private webCache = createResultCache<CachedWebEntry>(20 * 60_000, 30);

  constructor() {
    const initialNums = (process.env.ALLOWED_NUMBERS || '').split(',').map(normalizePhone).filter(Boolean);
    for (const n of initialNums) this.allowed.add(n);
    const initialGroups = (process.env.ALLOWED_GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const g of initialGroups) this.allowedGroups.add(g);
    this.allowGroups = String(process.env.ALLOW_GROUPS || 'false').toLowerCase() === 'true';
  }

  async init(): Promise<void> {
    await fs.mkdir(WEB_JOBS_DIR, { recursive: true });
    await this.loadPersistedConfig();
    if (await pathExists(COOKIES_FILE)) {
      const content = (await fs.readFile(COOKIES_FILE, 'utf8')).trim();
      if (content) {
        this.hasCookiesFile = true;
        updateRuntimeConfig({ ytdlpCookies: COOKIES_FILE });
      }
    } else if (getRuntimeConfig().ytdlpCookies) {
      this.hasCookiesFile = await pathExists(getRuntimeConfig().ytdlpCookies);
    }
    this.addLog('info', 'Panel y motor multimedia inicializados.');
  }

  private addLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.logs.unshift({ time: new Date().toISOString(), level, message });
    if (this.logs.length > 60) this.logs.length = 60;
  }

  private pushActivity(entry: ActivityEntry): void {
    this.activity.unshift(entry);
    if (this.activity.length > 50) this.activity.length = 50;
  }

  private async loadPersistedConfig(): Promise<void> {
    try {
      const raw = await fs.readFile(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoredBotConfig>;
      if (Array.isArray(parsed.allowedNumbers)) {
        this.allowed = new Set(parsed.allowedNumbers.map(normalizePhone).filter(Boolean));
      }
      if (Array.isArray(parsed.allowedGroups)) {
        this.allowedGroups = new Set(parsed.allowedGroups.map((s) => String(s).trim()).filter(Boolean));
      }
      if (typeof parsed.allowGroups === 'boolean') {
        this.allowGroups = parsed.allowGroups;
      }
      updateRuntimeConfig({
        maxDurationMin: parsed.maxDurationMin,
        maxDocMb: parsed.maxDocMb,
      });
    } catch {
      // Sin configuración guardada aún; se usan defaults / .env
    }
  }

  private async persistConfig(): Promise<void> {
    const cfg = this.getConfig();
    const payload: StoredBotConfig = {
      allowedNumbers: cfg.allowedNumbers,
      allowedGroups: cfg.allowedGroups,
      allowGroups: cfg.allowGroups,
      maxDurationMin: cfg.maxDurationMin,
      maxDocMb: cfg.maxDocMb,
    };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
  }

  getConfig() {
    const rt = getRuntimeConfig();
    return {
      allowedNumbers: [...this.allowed],
      allowedGroups: [...this.allowedGroups],
      allowGroups: this.allowGroups,
      maxDurationMin: rt.maxDurationMin,
      maxDocMb: rt.maxDocMb,
      hasCookies: this.hasCookiesFile,
    };
  }

  async updateConfig(patch: {
    allowedNumbers?: string[];
    allowedGroups?: string[];
    allowGroups?: boolean;
    maxDurationMin?: number;
    maxDocMb?: number;
    cookiesText?: string | null;
  }) {
    if (Array.isArray(patch.allowedNumbers)) {
      this.allowed = new Set(patch.allowedNumbers.map(normalizePhone).filter(Boolean));
    }
    if (Array.isArray(patch.allowedGroups)) {
      this.allowedGroups = new Set(patch.allowedGroups.map((s) => String(s).trim()).filter(Boolean));
    }
    if (typeof patch.allowGroups === 'boolean') {
      this.allowGroups = patch.allowGroups;
    }
    if (patch.maxDurationMin !== undefined || patch.maxDocMb !== undefined) {
      updateRuntimeConfig({
        maxDurationMin: patch.maxDurationMin,
        maxDocMb: patch.maxDocMb,
      });
    }
    if (patch.cookiesText !== undefined) {
      const clean = String(patch.cookiesText || '').trim();
      if (clean) {
        await fs.writeFile(COOKIES_FILE, clean, 'utf8');
        updateRuntimeConfig({ ytdlpCookies: COOKIES_FILE });
        this.hasCookiesFile = true;
        this.addLog('info', 'Archivo cookies.txt guardado para yt-dlp.');
      } else {
        await fs.rm(COOKIES_FILE, { force: true });
        updateRuntimeConfig({ ytdlpCookies: '' });
        this.hasCookiesFile = false;
        this.addLog('info', 'Cookies de yt-dlp eliminadas.');
      }
    }
    await this.persistConfig();
    this.addLog('info', `Configuración actualizada (${this.allowed.size} números en lista blanca).`);
    return this.getConfig();
  }

  async getCapabilities(): Promise<EnvCapabilities> {
    const rt = getRuntimeConfig();
    const [ffmpeg, ffprobe, ytdlp, hasAuthSession] = await Promise.all([
      checkBinary(rt.ffmpegBin, '-version'),
      checkBinary(rt.ffprobeBin, '-version'),
      checkBinary(rt.ytdlpBin, '--version'),
      pathExists(path.join(AUTH_DIR, 'creds.json')),
    ]);
    return {
      node: process.version,
      ffmpeg,
      ffprobe,
      ytdlp,
      hasAuthSession,
    };
  }

  async getStatus() {
    const hasAuthSession = await pathExists(path.join(AUTH_DIR, 'creds.json'));
    return {
      state: this.state,
      qrDataUrl: this.qrDataUrl,
      hasQr: Boolean(this.qrRaw),
      pairingCode: this.pairingCode,
      pairingPhone: this.pairingPhone,
      connectedPhone: this.connectedPhone,
      connectedName: this.connectedName,
      connectedSince: this.connectedSince,
      lastError: this.lastError,
      queueDepth: this.queueDepth,
      cacheSize: this.webCache.size(),
      hasAuthSession,
      allowedCount: this.allowed.size,
      logs: this.logs.slice(0, 25),
    };
  }

  getActivity() {
    return {
      entries: this.activity,
      cacheSize: this.webCache.size(),
    };
  }

  async clearCache(): Promise<void> {
    this.webCache.clear();
    this.addLog('info', 'Caché temporal limpiada.');
  }

  async connect(options: { pairingPhone?: string } = {}): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const pairingPhone = options.pairingPhone ? normalizePhone(options.pairingPhone) : null;
    if (options.pairingPhone && (!pairingPhone || pairingPhone.length < 8)) {
      throw new Error('Ingresa un número válido con código de país (solo dígitos, ej. 523312345678).');
    }

    if (this.sock) {
      await this.disconnect(true);
    }

    if (pairingPhone) {
      // Para Pairing Code limpio se requiere una sesión no registrada
      const hasCreds = await pathExists(path.join(AUTH_DIR, 'creds.json'));
      if (hasCreds) {
        await fs.rm(AUTH_DIR, { recursive: true, force: true });
      }
    }

    this.manualDisconnect = false;
    this.state = pairingPhone ? 'pairing' : 'connecting';
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.pairingPhone = pairingPhone;
    this.lastError = null;
    this.addLog('info', pairingPhone ? `Solicitando Pairing Code para ${pairingPhone}…` : 'Iniciando sesión de WhatsApp (Baileys)…');

    try {
      const baileys = await import('@whiskeysockets/baileys');
      const { default: pino } = await import('pino');
      const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
        normalizeMessageContent,
      } = baileys;

      await fs.mkdir(AUTH_DIR, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        browser: ['Video Bot Studio', 'Chrome', '1.0.0'],
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      if (pairingPhone && !state.creds.registered) {
        setTimeout(async () => {
          if (this.sock !== sock || this.manualDisconnect) return;
          try {
            const rawCode = await sock.requestPairingCode(pairingPhone);
            const formatted = rawCode?.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
            this.pairingCode = formatted || null;
            this.state = 'pairing';
            this.addLog('info', `Pairing Code generado: ${formatted}. Ingrésalo en WhatsApp → Dispositivos vinculados.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.lastError = `No se pudo generar el Pairing Code: ${msg}`;
            this.state = 'error';
            this.addLog('error', this.lastError);
          }
        }, 1800);
      }

      sock.ev.on('connection.update', async (update: { connection?: string; lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } }; qr?: string }) => {
        if (this.sock !== sock) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr && !this.pairingPhone) {
          this.qrRaw = qr;
          this.state = 'qr';
          this.lastError = null;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 300,
              margin: 2,
              color: { dark: '#141517', light: '#FFFFFF' },
            });
          } catch {
            this.qrDataUrl = null;
          }
          this.addLog('info', 'Código QR actualizado. Escanéalo desde WhatsApp → Dispositivos vinculados.');
        }

        if (connection === 'open') {
          this.state = 'connected';
          this.qrRaw = null;
          this.qrDataUrl = null;
          this.pairingCode = null;
          this.lastError = null;
          this.connectedPhone = normalizePhone(sock.user?.id) || null;
          this.connectedName = sock.user?.name || null;
          this.connectedSince = new Date().toISOString();
          this.addLog('info', `Conectado a WhatsApp como ${this.connectedPhone || 'cuenta vinculada'}.`);
          if (this.allowed.size === 0 && this.connectedPhone) {
            this.addLog('warn', 'Lista blanca vacía: agrega al menos un número en Configuración para que el bot responda.');
          }
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          const errMsg = lastDisconnect?.error?.message;
          this.qrRaw = null;
          this.qrDataUrl = null;
          this.connectedSince = null;

          if (this.manualDisconnect) {
            this.state = 'disconnected';
            this.sock = null;
            return;
          }

          if (code === DisconnectReason.loggedOut) {
            this.state = 'disconnected';
            this.lastError = 'Sesión cerrada desde el teléfono. Vuelve a vincular con QR o Pairing Code.';
            this.addLog('warn', this.lastError);
            await fs.rm(AUTH_DIR, { recursive: true, force: true });
            this.sock = null;
            return;
          }

          this.state = 'connecting';
          this.lastError = errMsg ? `Reconectando (${code || 'red'}): ${errMsg}` : `Conexión cerrada (${code || 'red'}); reconectando…`;
          this.addLog('warn', this.lastError);
          this.reconnectTimer = setTimeout(() => {
            if (!this.manualDisconnect) {
              this.connect().catch((e) => {
                this.state = 'error';
                this.lastError = e instanceof Error ? e.message : String(e);
              });
            }
          }, 3500);
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sock.ev.on('messages.upsert', ({ messages, type }: { messages: any[]; type: string }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          if (this.sent.has(msg?.key?.id)) continue;
          this.queueDepth += 1;
          this.queue = this.queue
            .then(() => this.handleIncomingWhatsAppMessage(sock, msg, normalizeMessageContent))
            .catch((e) => this.addLog('error', `Error procesando mensaje: ${e instanceof Error ? e.message : String(e)}`))
            .finally(() => {
              this.queueDepth = Math.max(0, this.queueDepth - 1);
            });
        }
      });
    } catch (err) {
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.addLog('error', `Error al iniciar Baileys: ${this.lastError}`);
      throw err;
    }
  }

  async disconnect(silent = false): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.end(new Error('Desconectado desde el panel'));
      } catch {
        // ignore
      }
      this.sock = null;
    }
    this.state = 'disconnected';
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.pairingPhone = null;
    this.connectedPhone = null;
    this.connectedName = null;
    this.connectedSince = null;
    if (!silent) {
      this.addLog('info', 'Bot desconectado manualmente.');
    }
  }

  async logout(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // ignore
      }
    }
    await this.disconnect(true);
    await fs.rm(AUTH_DIR, { recursive: true, force: true });
    this.addLog('info', 'Sesión de WhatsApp eliminada (carpeta ./auth borrada).');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleIncomingWhatsAppMessage(sock: any, msg: any, normalize: (m: any) => any): Promise<void> {
    const content = normalize(msg.message);
    const text: string | undefined =
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      content?.imageMessage?.caption ||
      content?.videoMessage?.caption;
    if (!text) return;

    const admin = parseAdminCommand(text);
    const cmd = parseMessageCommand(text);
    if (!admin && !cmd.links.length) return;

    const jid: string | undefined = msg.key?.remoteJid;
    if (!jid || jid === 'status@broadcast') return;
    const isGroup = jid.endsWith('@g.us');
    const senderJid = isGroup ? msg.key?.participant || msg.participant : jid;
    const jids: Array<string | null | undefined> = [senderJid, msg.key?.remoteJidAlt];

    if (senderJid?.endsWith('@lid')) {
      try {
        jids.push(await sock.signalRepository?.lidMapping?.getPNForLID?.(senderJid));
      } catch {
        // sin mapeo LID
      }
    }

    const ownPhone = normalizePhone(sock.user?.id);
    const mentioned: string[] = content?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const mentionedMe = mentioned.some((m) => normalizePhone(m) === ownPhone);

    const authorized = isAllowedSender({
      allowed: this.allowed,
      allowedGroups: this.allowedGroups,
      allowGroups: this.allowGroups,
      jids,
      ownId: sock.user?.id,
      fromMe: Boolean(msg.key?.fromMe),
      isGroup,
      groupJid: isGroup ? jid : '',
      mentionedMe,
    });

    if (!authorized) {
      if (!msg.key?.fromMe) {
        this.addLog('warn', `Mensaje ignorado (no autorizado): ${senderJid || jid}`);
      }
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send = (payload: any, opts = {}) => sock.sendMessage(jid, payload, { ...opts, messageId: this.sent.newId() });

    if (admin) {
      await this.handleAdminCommand(admin, send, msg);
      return;
    }

    const react = (emoji: string) => send({ react: { text: emoji, key: msg.key } }).catch(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wabot-'));
    const started = Date.now();
    try {
      await react('⏳');
      for (const [idx, link] of cmd.links.entries()) {
        const subDir = path.join(dir, `l-${idx}`);
        const replies = await buildReplies(text, subDir, { linkOverride: link, mode: cmd.mode, trim: cmd.trim });
        let totalBytes = 0;
        for (const r of replies) {
          totalBytes += r.bytes || 0;
          if (r.type === 'text') await send({ text: r.text }, { quoted: msg });
          else if (r.type === 'video' && r.path)
            await send({ video: { url: r.path }, mimetype: 'video/mp4', caption: r.caption }, { quoted: msg });
          else if (r.type === 'audio' && r.path)
            await send({ audio: { url: r.path }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
          else if (r.type === 'image' && r.path)
            await send({ image: { url: r.path }, ...(r.caption ? { caption: r.caption } : {}) }, { quoted: msg });
          else if (r.type === 'document' && r.path)
            await send(
              { document: { url: r.path }, mimetype: r.mimetype, fileName: r.fileName, caption: r.caption },
              { quoted: msg },
            );
        }
        this.pushActivity({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          source: 'whatsapp',
          sender: normalizePhone(senderJid) || jid,
          platform: link.kind,
          url: link.url,
          mode: cmd.mode,
          trim: cmd.trim?.raw || null,
          status: replies.some((r) => r.text?.startsWith('⚠️') || r.text?.startsWith('🤷')) ? 'error' : 'ok',
          summary: replies[0]?.meta?.title || replies[0]?.note || replies[0]?.text?.slice(0, 80) || 'Enviado',
          bytes: totalBytes,
          durationMs: Date.now() - started,
        });
      }
      await react('✅');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.addLog('error', `Falló envío en WhatsApp: ${errMsg}`);
      await react('❌');
      await send({ text: '⚠️ Falló el envío por WhatsApp.' }, { quoted: msg }).catch(() => {});
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  private async handleAdminCommand(
    admin: NonNullable<ReturnType<typeof parseAdminCommand>>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: (payload: any, opts?: any) => Promise<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
  ): Promise<void> {
    if (admin.cmd === 'allow' && admin.valid) {
      this.allowed.add(admin.phone);
      await this.persistConfig();
      this.addLog('info', `Admin chat: añadido ${admin.phone} a lista blanca.`);
      await send({ text: `✅ Número autorizado: ${admin.phone}` }, { quoted: msg });
      return;
    }
    if (admin.cmd === 'remove' && admin.valid) {
      this.allowed.delete(admin.phone);
      await this.persistConfig();
      this.addLog('info', `Admin chat: eliminado ${admin.phone} de lista blanca.`);
      await send({ text: `🗑️ Número eliminado de la lista blanca: ${admin.phone}` }, { quoted: msg });
      return;
    }
    if (admin.cmd === 'limit' && admin.valid) {
      updateRuntimeConfig({ maxDurationMin: admin.minutes });
      await this.persistConfig();
      this.addLog('info', `Admin chat: límite de duración ajustado a ${admin.minutes} min.`);
      await send({ text: `⏱️ Límite de duración actualizado a ${admin.minutes} min.` }, { quoted: msg });
      return;
    }
    if (admin.cmd === 'status') {
      const cfg = this.getConfig();
      await send(
        {
          text: `🤖 *Video Bot Studio*\nLista blanca: ${cfg.allowedNumbers.length} número(s)\nGrupos: ${cfg.allowGroups ? 'activos' : 'bloqueados'}\nLímite video: ${cfg.maxDurationMin} min · Doc: ${cfg.maxDocMb} MB\nCaché: ${this.webCache.size()} entrada(s)`,
        },
        { quoted: msg },
      );
      return;
    }
    await send(
      {
        text:
          '📖 *Comandos en WhatsApp*\n• `<link>` — video comprimido (<16 MB)\n• `audio <link>` — solo audio MP3\n• `doc <link>` — documento calidad original\n• `0:15-0:45 <link>` — recorte con FFmpeg\n• `/allow <número>` · `/remove <número>` · `/limit <min>` · `/status`',
      },
      { quoted: msg },
    );
  }

  async extractFromWeb(input: {
    text: string;
    mode?: ExtractMode;
    trim?: string;
    bypassCache?: boolean;
  }): Promise<WebExtractResult> {
    const started = Date.now();
    const rawText = String(input.text || '').trim();
    if (!rawText) {
      throw new Error('Pega al menos un enlace de YouTube, X, Instagram, TikTok o Reddit.');
    }

    const parsedCmd = parseMessageCommand(rawText);
    const link = parsedCmd.links[0];
    if (!link) {
      throw new Error('No se detectó ninguna URL válida (debe empezar con http:// o https://).');
    }

    const mode: ExtractMode = input.mode || parsedCmd.mode || 'video';
    const trimInput = input.trim?.trim();
    const trim = trimInput ? parseTrimRange(trimInput) : parsedCmd.trim;
    if (trimInput && !trim) {
      throw new Error('Formato de recorte inválido. Usa mm:ss-mm:ss (ejemplo: 0:15-0:45) con fin mayor al inicio.');
    }

    const cacheKey = this.webCache.makeKey(link.url, mode, trim?.raw || '');
    if (!input.bypassCache && link.kind !== 'unsupported') {
      const cached = this.webCache.get(cacheKey);
      if (cached && (await pathExists(cached.dir))) {
        const result: WebExtractResult = {
          ...cached.result,
          cached: true,
          durationMs: Date.now() - started,
        };
        this.pushActivity({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          source: 'web',
          sender: 'Extractor Web',
          platform: link.kind,
          url: link.url,
          mode,
          trim: trim?.raw || null,
          status: 'cached',
          summary: result.replies[0]?.meta?.title || result.replies[0]?.note || 'Recuperado de caché',
          bytes: result.replies.reduce((acc, r) => acc + (r.bytes || 0), 0),
          durationMs: result.durationMs,
        });
        return result;
      }
    }

    const jobId = randomUUID().slice(0, 12);
    const jobDir = path.join(WEB_JOBS_DIR, jobId);
    const rawReplies = await buildReplies(rawText, jobDir, { linkOverride: link, mode, trim });

    const webReplies: WebExtractReply[] = rawReplies.map((r) => {
      let mediaUrl: string | undefined;
      let downloadUrl: string | undefined;
      if (r.path) {
        const baseName = path.basename(r.path);
        mediaUrl = `/api/media/${encodeURIComponent(jobId)}/${encodeURIComponent(baseName)}`;
        downloadUrl = `${mediaUrl}?download=1&name=${encodeURIComponent(r.fileName || baseName)}`;
      }
      return {
        type: r.type,
        text: r.text,
        caption: r.caption,
        note: r.note,
        bytes: r.bytes,
        fileName: r.fileName,
        mimetype: r.mimetype,
        mediaUrl,
        downloadUrl,
        meta: r.meta,
        comments: r.comments,
      };
    });

    const durationMs = Date.now() - started;
    const result: WebExtractResult = {
      jobId,
      link,
      mode,
      trim: trim?.raw || null,
      cached: false,
      durationMs,
      replies: webReplies,
    };

    const isError = webReplies.length === 1 && (webReplies[0].text?.startsWith('⚠️') || webReplies[0].text?.startsWith('🤷'));
    if (!isError && link.kind !== 'unsupported') {
      this.webCache.set(cacheKey, { jobId, dir: jobDir, result });
    }

    const totalBytes = webReplies.reduce((acc, r) => acc + (r.bytes || 0), 0);
    this.pushActivity({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'web',
      sender: 'Extractor Web',
      platform: link.kind,
      url: link.url,
      mode,
      trim: trim?.raw || null,
      status: isError ? 'error' : 'ok',
      summary:
        webReplies[0]?.meta?.title ||
        webReplies[0]?.note ||
        webReplies[0]?.text?.slice(0, 90) ||
        'Procesado',
      bytes: totalBytes,
      durationMs,
    });

    this.pruneOldWebJobs().catch(() => {});
    return result;
  }

  private async pruneOldWebJobs(): Promise<void> {
    const entries = await fs.readdir(WEB_JOBS_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (dirs.length <= 25) return;
    const stats = await Promise.all(
      dirs.map(async (name) => {
        const full = path.join(WEB_JOBS_DIR, name);
        const s = await fs.stat(full);
        return { full, mtime: s.mtimeMs };
      }),
    );
    stats.sort((a, b) => a.mtime - b.mtime);
    for (const old of stats.slice(0, stats.length - 25)) {
      await fs.rm(old.full, { recursive: true, force: true });
    }
  }
}
