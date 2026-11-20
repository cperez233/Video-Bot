import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaption,
  buildCommentsText,
  createResultCache,
  createSentTracker,
  isAllowedSender,
  normalizePhone,
  parseAdminCommand,
  parseLink,
  parseLinks,
  parseMessageCommand,
  parseTrimRange,
} from './lib.js';

test('parseLink recognizes YouTube, X, Instagram, TikTok, Reddit and unsupported links', () => {
  assert.deepEqual(parseLink('Mira https://youtu.be/dQw4w9WgXcQ?t=10'), {
    kind: 'youtube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    id: 'dQw4w9WgXcQ',
  });
  assert.deepEqual(parseLink('https://x.com/vercel/status/1899999999999999999'), {
    kind: 'x',
    url: 'https://x.com/vercel/status/1899999999999999999',
    id: '1899999999999999999',
  });
  assert.deepEqual(parseLink('https://www.instagram.com/reels/C8abc12345/'), {
    kind: 'instagram',
    url: 'https://www.instagram.com/reel/C8abc12345/',
    id: 'C8abc12345',
  });
  assert.deepEqual(parseLink('https://www.tiktok.com/@creator/video/7345678901234567890'), {
    kind: 'tiktok',
    url: 'https://www.tiktok.com/@creator/video/7345678901234567890',
    id: '7345678901234567890',
  });
  assert.deepEqual(parseLink('https://www.reddit.com/r/programming/comments/1abcde/title/'), {
    kind: 'reddit',
    url: 'https://www.reddit.com/r/programming/comments/1abcde/',
    id: '1abcde',
  });
  assert.equal(parseLink('https://example.com/page')?.kind, 'unsupported');
  assert.equal(parseLink('solo texto sin enlaces'), null);
});

test('parseLinks extracts multiple deduplicated links in a single message', () => {
  const links = parseLinks(
    'Dos links: https://youtu.be/abc123 y https://x.com/user/status/999 y repetido https://www.youtube.com/watch?v=abc123',
  );
  assert.equal(links.length, 2);
  assert.equal(links[0].kind, 'youtube');
  assert.equal(links[1].kind, 'x');
});

test('parseMessageCommand extracts mode (audio/document/video) and trim range', () => {
  const audioCmd = parseMessageCommand('audio 0:15-0:45 https://youtu.be/abc123');
  assert.equal(audioCmd.mode, 'audio');
  assert.equal(audioCmd.trim?.startSec, 15);
  assert.equal(audioCmd.trim?.endSec, 45);
  assert.equal(audioCmd.links.length, 1);

  const docCmd = parseMessageCommand('doc https://x.com/user/status/12345');
  assert.equal(docCmd.mode, 'document');
  assert.equal(docCmd.trim, null);

  assert.equal(parseTrimRange('0:45-0:15'), null);
  assert.equal(parseTrimRange('1:00-1:30')?.durationSec, 30);
});

test('parseAdminCommand parses /allow, /remove, /limit, /status, /help', () => {
  assert.deepEqual(parseAdminCommand('/allow +52 1 33 1234 5678'), {
    cmd: 'allow',
    phone: '523312345678',
    valid: true,
  });
  assert.deepEqual(parseAdminCommand('/remove 15551234567'), {
    cmd: 'remove',
    phone: '15551234567',
    valid: true,
  });
  assert.deepEqual(parseAdminCommand('/limit 35'), {
    cmd: 'limit',
    minutes: 35,
    valid: true,
  });
  assert.equal(parseAdminCommand('/limit 999')?.valid, false);
  assert.equal(parseAdminCommand('/status')?.cmd, 'status');
  assert.equal(parseAdminCommand('hola mundo'), null);
});

test('normalizePhone and isAllowedSender handle 1:1, self-chat, and group authorization', () => {
  assert.equal(normalizePhone('+52 1 33 1234 5678'), '523312345678');
  assert.equal(normalizePhone('5213312345678@s.whatsapp.net'), '523312345678');

  const allowed = new Set(['523312345678']);
  assert.equal(
    isAllowedSender({ allowed, jids: ['5213312345678@s.whatsapp.net'], ownId: '15550001111:1@s.whatsapp.net', fromMe: false }),
    true,
  );
  // Self-chat allowed when ownId matches allowed
  assert.equal(
    isAllowedSender({ allowed, jids: ['523312345678@s.whatsapp.net'], ownId: '523312345678:1@s.whatsapp.net', fromMe: true }),
    true,
  );
  // Group blocked by default
  assert.equal(
    isAllowedSender({
      allowed,
      allowGroups: false,
      isGroup: true,
      groupJid: '12345@g.us',
      jids: ['523312345678@s.whatsapp.net'],
    }),
    false,
  );
  // Group allowed when enabled and whitelisted
  assert.equal(
    isAllowedSender({
      allowed,
      allowGroups: true,
      allowedGroups: new Set(['12345@g.us']),
      isGroup: true,
      groupJid: '12345@g.us',
      jids: ['523312345678@s.whatsapp.net'],
    }),
    true,
  );
});

test('buildCaption, buildCommentsText, sentTracker and resultCache work deterministically', () => {
  const caption = buildCaption({ title: 'Demo *video*', byline: '@canal', likes: 1200, platform: 'YouTube' });
  assert.ok(caption.includes('*Demo video*'));
  assert.ok(caption.includes('YouTube · 👍'));
  assert.ok(caption.length <= 1024);

  const commentsText = buildCommentsText([
    { author: 'Ana', text: 'Primero', like_count: 10, parent: 'root' },
    { author: 'Luis', text: 'Mejor comentario', like_count: 250, parent: 'root' },
    { author: 'Reply', text: 'Respuesta ignorada', like_count: 999, parent: 'child' },
  ]);
  assert.ok(commentsText?.includes('1. *Luis*'));
  assert.ok(!commentsText?.includes('Respuesta ignorada'));

  const tracker = createSentTracker(2);
  const id1 = tracker.newId();
  const id2 = tracker.newId();
  const id3 = tracker.newId();
  assert.equal(tracker.has(id1), false);
  assert.equal(tracker.has(id2), true);
  assert.equal(tracker.has(id3), true);

  const cache = createResultCache<string>(1000, 2);
  const key = cache.makeKey('https://x.com/a/status/1', 'video', '');
  cache.set(key, 'ok', 100);
  assert.equal(cache.get(key, 500), 'ok');
  assert.equal(cache.get(key, 1200), null);
});
