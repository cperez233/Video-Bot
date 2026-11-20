export const WA_VIDEO_LIMIT: number;
export const SUPPORTED_PLATFORMS: string[];

export interface ParsedLink {
  kind: 'youtube' | 'x' | 'instagram' | 'tiktok' | 'reddit' | 'unsupported';
  url: string;
  id?: string;
}

export interface TrimRange {
  raw: string;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export type ExtractMode = 'video' | 'document' | 'audio';

export interface MessageCommand {
  links: ParsedLink[];
  mode: ExtractMode;
  trim: TrimRange | null;
}

export type AdminCommand =
  | { cmd: 'allow'; phone: string; valid: boolean }
  | { cmd: 'remove'; phone: string; valid: boolean }
  | { cmd: 'limit'; minutes: number; valid: boolean }
  | { cmd: 'status'; valid: boolean }
  | { cmd: 'help'; valid: boolean };

export interface RuntimeConfig {
  maxDurationMin: number;
  maxDocMb: number;
  ytdlpCookies: string;
  ytdlpBin: string;
  ffmpegBin: string;
  ffprobeBin: string;
}

export interface ReplyComment {
  author: string;
  likes: number;
  text: string;
}

export interface ReplyItem {
  type: 'text' | 'video' | 'audio' | 'image' | 'document';
  text?: string;
  path?: string;
  bytes?: number;
  note?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  meta?: {
    platform?: string;
    title?: string;
    byline?: string;
    likes?: number;
  };
  comments?: ReplyComment[];
}

export function getRuntimeConfig(): RuntimeConfig;
export function updateRuntimeConfig(patch: Partial<RuntimeConfig>): RuntimeConfig;
export function parseLinks(text: string): ParsedLink[];
export function parseLink(text: string): ParsedLink | null;
export function parseTimestampToSeconds(ts: string): number | null;
export function formatSecondsToTimestamp(totalSec: number): string;
export function parseTrimRange(text: string): TrimRange | null;
export function parseMessageCommand(text: string): MessageCommand;
export function parseAdminCommand(text: string): AdminCommand | null;
export function normalizePhone(v: unknown): string;
export function isAllowedSender(opts: {
  allowed: Set<string>;
  allowedGroups?: Set<string>;
  allowGroups?: boolean;
  jids?: Array<string | null | undefined>;
  ownId?: string | null;
  fromMe?: boolean;
  isGroup?: boolean;
  groupJid?: string;
  mentionedMe?: boolean;
}): boolean;

export function createSentTracker(max?: number): {
  newId: () => string;
  has: (id?: string | null) => boolean;
};

export function createResultCache<T = unknown>(
  ttlMs?: number,
  maxEntries?: number,
): {
  makeKey: (url: string, mode?: string, trimRaw?: string) => string;
  get: (key: string, now?: number) => T | null;
  set: (key: string, value: T, now?: number) => void;
  clear: () => void;
  size: (now?: number) => number;
};

export function buildCaption(meta: {
  title?: string;
  byline?: string;
  likes?: number;
  platform?: string;
}): string;

export function buildCommentsText(
  comments?: Array<{ author?: string; text?: string; like_count?: number; parent?: string | null }> | null,
): string | null;

export function extractTopComments(
  comments?: Array<{ author?: string; text?: string; like_count?: number; parent?: string | null }> | null,
): ReplyComment[];

export function buildReplies(
  text: string,
  dir: string,
  options?: { mode?: ExtractMode; trim?: TrimRange | null; linkOverride?: ParsedLink | null },
): Promise<ReplyItem[]>;

export function fmtNum(n: number | undefined): string;
export function truncate(s: string | undefined, max: number): string;
