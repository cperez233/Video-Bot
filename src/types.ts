export type TabId = 'extractor' | 'bot' | 'config' | 'activity';

export type ExtractMode = 'video' | 'document' | 'audio';

export type BotConnectionState = 'disconnected' | 'connecting' | 'qr' | 'pairing' | 'connected' | 'error';

export interface EnvCapabilities {
  node: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
  hasAuthSession: boolean;
}

export interface BotLogItem {
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface BotStatus {
  state: BotConnectionState;
  qrDataUrl: string | null;
  hasQr: boolean;
  pairingCode: string | null;
  pairingPhone: string | null;
  connectedPhone: string | null;
  connectedName: string | null;
  connectedSince: string | null;
  lastError: string | null;
  queueDepth: number;
  cacheSize: number;
  hasAuthSession: boolean;
  allowedCount: number;
  logs: BotLogItem[];
}

export interface BotConfig {
  allowedNumbers: string[];
  allowedGroups: string[];
  allowGroups: boolean;
  maxDurationMin: number;
  maxDocMb: number;
  hasCookies: boolean;
}

export interface ReplyComment {
  author: string;
  likes: number;
  text: string;
}

export interface WebExtractReply {
  type: 'text' | 'video' | 'audio' | 'image' | 'document';
  text?: string;
  caption?: string;
  note?: string;
  bytes?: number;
  fileName?: string;
  mimetype?: string;
  mediaUrl?: string;
  downloadUrl?: string;
  meta?: {
    platform?: string;
    title?: string;
    byline?: string;
    likes?: number;
  };
  comments?: ReplyComment[];
}

export interface WebExtractResult {
  jobId: string;
  link: {
    kind: string;
    url: string;
    id?: string;
  };
  mode: ExtractMode;
  trim: string | null;
  cached: boolean;
  durationMs: number;
  replies: WebExtractReply[];
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
