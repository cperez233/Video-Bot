import type { BotConnectionState } from '../types';

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function normalizePhonePreview(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return /^521\d{10}$/.test(digits) ? '52' + digits.slice(3) : digits;
}

export function platformLabel(kind: string): string {
  const map: Record<string, string> = {
    youtube: 'YouTube',
    x: 'X (Twitter)',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    reddit: 'Reddit',
    unsupported: 'No soportado',
  };
  return map[kind] || kind;
}

export function detectPlatformFromInput(input: string): string | null {
  const m = input.match(/https?:\/\/[^\s<>]+/i);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|music|old|np)\./, '');
    if (host === 'youtu.be' || host === 'youtube.com') return 'YouTube';
    if (['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com'].includes(host)) return 'X (Twitter)';
    if (host === 'instagram.com' || host === 'ddinstagram.com') return 'Instagram';
    if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return 'TikTok';
    if (host === 'reddit.com' || host === 'redd.it') return 'Reddit';
    return 'Enlace no soportado';
  } catch {
    return null;
  }
}

export function botStateLabel(state: BotConnectionState): { label: string; tone: 'neutral' | 'amber' | 'green' | 'red' } {
  switch (state) {
    case 'connected':
      return { label: 'Conectado', tone: 'green' };
    case 'qr':
      return { label: 'Esperando escaneo QR', tone: 'amber' };
    case 'pairing':
      return { label: 'Esperando código de 8 dígitos', tone: 'amber' };
    case 'connecting':
      return { label: 'Conectando…', tone: 'amber' };
    case 'error':
      return { label: 'Error de conexión', tone: 'red' };
    default:
      return { label: 'Desconectado', tone: 'neutral' };
  }
}
