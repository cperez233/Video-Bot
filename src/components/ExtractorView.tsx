import { useState, type FormEvent } from 'react';
import { Download, Copy, Check, Scissors, Film, FileText, Music, AlertCircle, RotateCw } from 'lucide-react';
import type { EnvCapabilities, ExtractMode, WebExtractResult } from '../types';
import { detectPlatformFromInput, formatBytes, platformLabel } from '../utils/format';

interface ExtractorViewProps {
  capabilities: EnvCapabilities | null;
  onExtracted: () => void;
}

const MODE_OPTIONS: Array<{ id: ExtractMode; label: string; desc: string; icon: typeof Film }> = [
  { id: 'video', label: 'Video WA (<16 MB)', desc: 'Comprime con FFmpeg', icon: Film },
  { id: 'document', label: 'Documento HD', desc: 'Calidad original', icon: FileText },
  { id: 'audio', label: 'Solo audio MP3', desc: 'Pista 128 kbps', icon: Music },
];

const SAMPLE_LINKS = [
  { label: 'Probar tweet de X', value: 'https://x.com/jack/status/20' },
  { label: 'Probar enlace YouTube', value: 'https://youtu.be/dQw4w9WgXcQ' },
  { label: 'Probar enlace no soportado', value: 'https://example.com/articulo' },
];

export function ExtractorView({ capabilities, onExtracted }: ExtractorViewProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ExtractMode>('video');
  const [trim, setTrim] = useState('');
  const [bypassCache, setBypassCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebExtractResult | null>(null);
  const [copiedCaption, setCopiedCaption] = useState(false);

  const detected = detectPlatformFromInput(text);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!text.trim()) {
      setError('Pega un enlace de YouTube, X, Instagram, TikTok o Reddit antes de extraer.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          mode,
          trim: trim.trim() || undefined,
          bypassCache,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Ocurrió un error al procesar el enlace.');
        setResult(null);
      } else {
        setResult(data as WebExtractResult);
        onExtracted();
      }
    } catch {
      setError('No se pudo conectar con el servidor local.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyCaption(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 1800);
    } catch {
      // Clipboard fallback no-op
    }
  }

  const mediaReplies = result?.replies.filter((r) => r.type !== 'text') || [];
  const primaryMedia = mediaReplies[0] || null;
  const extraImages = mediaReplies.slice(1).filter((r) => r.type === 'image');
  const textReplies = result?.replies.filter((r) => r.type === 'text') || [];
  const commentsReply = textReplies.find((r) => r.comments || r.text?.startsWith('💬')) || null;
  const noticeReplies = textReplies.filter((r) => r !== commentsReply && r.text?.startsWith('ℹ️'));
  const standaloneTextReplies = textReplies.filter((r) => r !== commentsReply && !r.text?.startsWith('ℹ️'));
  const captionText = primaryMedia?.caption || standaloneTextReplies[0]?.text || '';
  const totalBytes = mediaReplies.reduce((sum, r) => sum + (r.bytes || 0), 0);
  const isFailureOnly =
    Boolean(result) &&
    mediaReplies.length === 0 &&
    result!.replies.length === 1 &&
    (result!.replies[0].text?.startsWith('⚠️') || result!.replies[0].text?.startsWith('🤷'));

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-[#141517]">
          Extractor multimedia directo
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#575A61]">
          Procesa enlaces de YouTube, X, Instagram, TikTok o Reddit directamente desde el navegador usando el mismo
          motor de compresión FFmpeg que usa el bot de WhatsApp — sin necesidad de vincular una cuenta.
        </p>
      </div>

      {capabilities && !capabilities.ytdlp && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-5 py-3.5 text-sm text-[#92400E] flex items-start gap-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[#B45309]" />
          <div>
            <span className="font-semibold">yt-dlp no detectado en este contenedor:</span> los tweets de X (texto, fotos y
            videos MP4 directos) y FFmpeg funcionan al instante; para YouTube, Instagram, TikTok o Reddit en tu equipo
            instala <code className="font-mono text-xs bg-[#FEF3C7] px-1.5 py-0.5 rounded">pip install -U &quot;yt-dlp[default]&quot;</code>.
          </div>
        </div>
      )}

      {/* Formulario principal */}
      <form onSubmit={handleSubmit} className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-4 mb-2">
            <label htmlFor="extract-url" className="text-sm font-semibold text-[#141517]">
              Enlace o mensaje con comando
            </label>
            {detected && (
              <span className="text-xs font-medium text-[#146C43]">
                Detectado: {detected}
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="extract-url"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://x.com/usuario/status/... o https://youtu.be/..."
              className="flex-1 h-11 px-4 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-sm text-[#141517] placeholder:text-[#8E929B] focus:bg-white focus:border-[#146C43] transition-colors font-mono"
            />
            <button
              type="submit"
              disabled={loading}
              className="h-11 px-5 rounded-lg bg-[#146C43] hover:bg-[#0F5334] disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? <RotateCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {loading ? 'Procesando…' : 'Extraer contenido'}
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-[#6B6F76]">
            <span>Ejemplos rápidos:</span>
            {SAMPLE_LINKS.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => {
                  setText(sample.value);
                  setError(null);
                }}
                className="text-[#3F4248] hover:text-[#146C43] underline underline-offset-2 transition-colors cursor-pointer"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-[#EFEFEA] grid grid-cols-1 lg:grid-cols-12 gap-5 items-end">
          <div className="lg:col-span-7">
            <span className="block text-xs font-semibold text-[#575A61] mb-2">Formato de salida</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-1 bg-[#F2F2EE] rounded-lg" role="radiogroup" aria-label="Formato de salida">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(opt.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#FFFFFF] text-[#141517] shadow-xs'
                        : 'text-[#575A61] hover:text-[#141517]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#146C43]' : 'text-[#71757D]'}`} />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold whitespace-nowrap truncate">{opt.label}</span>
                      <span className="block text-[11px] text-[#6B6F76] truncate">{opt.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-3">
            <label htmlFor="trim-range" className="flex items-center gap-1.5 text-xs font-semibold text-[#575A61] mb-2">
              <Scissors className="w-3.5 h-3.5 text-[#71757D]" />
              Recorte opcional (FFmpeg)
            </label>
            <input
              id="trim-range"
              type="text"
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
              placeholder="0:15-0:45"
              className="w-full h-10 px-3 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-sm font-mono text-[#141517] placeholder:text-[#8E929B] focus:bg-white focus:border-[#146C43]"
            />
          </div>

          <div className="lg:col-span-2 flex items-center h-10">
            <label className="inline-flex items-center gap-2 text-xs text-[#575A61] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bypassCache}
                onChange={(e) => setBypassCache(e.target.checked)}
                className="w-4 h-4 rounded border-[#C8C8C1] accent-[#146C43]"
              />
              <span>Ignorar caché</span>
            </label>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#991B1B] flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#B91C1C]" />
            <span>{error}</span>
          </div>
        )}
      </form>

      {/* Estado de carga */}
      {loading && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-8 space-y-4">
          <div className="flex items-center gap-3 text-sm font-medium text-[#141517]">
            <RotateCw className="w-4 h-4 animate-spin text-[#146C43]" />
            <span>Descargando metadatos y preparando el archivo con FFmpeg…</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
            <div className="lg:col-span-7 h-64 rounded-lg bg-[#EFEFEA]" />
            <div className="lg:col-span-5 space-y-3">
              <div className="h-6 w-3/4 rounded bg-[#EFEFEA]" />
              <div className="h-4 w-1/2 rounded bg-[#EFEFEA]" />
              <div className="h-28 rounded bg-[#EFEFEA]" />
            </div>
          </div>
        </div>
      )}

      {/* Aviso único cuando la extracción devolvió error o enlace no soportado */}
      {!loading && result && isFailureOnly && (
        <section aria-label="Resultado de extracción" className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-xs text-[#575A61] font-mono tabular-nums">
            <span className="font-sans font-semibold text-[#141517]">{platformLabel(result.link.kind)}</span>
            <span aria-hidden="true">·</span>
            <span>Modo {result.mode}</span>
            <span aria-hidden="true">·</span>
            <span>{(result.durationMs / 1000).toFixed(2)} s</span>
          </div>
          <div role="status" className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3.5 text-sm text-[#991B1B] flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[#B91C1C]" />
            <span>{result.replies[0].text}</span>
          </div>
        </section>
      )}

      {/* Resultado extraído */}
      {!loading && result && !isFailureOnly && (
        <section aria-label="Resultado de extracción" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna izquierda: Vista previa multimedia */}
          <div className="lg:col-span-7 bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EFEFEA] flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-[#575A61] font-mono tabular-nums">
                <span className="font-sans font-semibold text-[#141517]">{platformLabel(result.link.kind)}</span>
                <span aria-hidden="true">·</span>
                <span>Modo {result.mode}</span>
                {result.trim && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Recorte {result.trim}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>{(result.durationMs / 1000).toFixed(2)} s</span>
                {result.cached && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#146C43] font-sans font-medium">desde caché</span>
                  </>
                )}
              </div>

              {primaryMedia?.downloadUrl && (
                <a
                  href={primaryMedia.downloadUrl}
                  download={primaryMedia.fileName}
                  className="px-3.5 py-1.5 rounded-lg bg-[#146C43] hover:bg-[#0F5334] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar ({formatBytes(primaryMedia.bytes)})
                </a>
              )}
            </div>

            <div className="p-5 space-y-4">
              {primaryMedia?.type === 'video' || primaryMedia?.type === 'document' ? (
                <video
                  src={primaryMedia.mediaUrl}
                  controls
                  playsInline
                  className="w-full max-h-[460px] rounded-lg bg-[#141517] object-contain"
                />
              ) : primaryMedia?.type === 'audio' ? (
                <div className="p-6 rounded-lg bg-[#F7F7F5] border border-[#E5E5E0] space-y-3">
                  <div className="text-sm font-semibold text-[#141517]">
                    {primaryMedia.meta?.title || 'Pista de audio extraída'}
                  </div>
                  <audio src={primaryMedia.mediaUrl} controls className="w-full" />
                </div>
              ) : primaryMedia?.type === 'image' ? (
                <div className="space-y-3">
                  <img
                    src={primaryMedia.mediaUrl}
                    alt={primaryMedia.meta?.title || 'Imagen extraída'}
                    className="w-full max-h-[460px] rounded-lg object-contain bg-[#F7F7F5]"
                  />
                  {extraImages.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {extraImages.map((img, i) => (
                        <div key={img.mediaUrl || i} className="space-y-1.5">
                          <img
                            src={img.mediaUrl}
                            alt={`Foto adicional ${i + 2}`}
                            className="w-full h-36 object-cover rounded-lg bg-[#F7F7F5]"
                          />
                          {img.downloadUrl && (
                            <a
                              href={img.downloadUrl}
                              download={img.fileName}
                              className="text-xs text-[#146C43] hover:underline font-medium inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              Foto {i + 2} ({formatBytes(img.bytes)})
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg bg-[#F7F7F5] border border-[#E5E5E0] p-6 text-sm text-[#3F4248] whitespace-pre-wrap">
                  {standaloneTextReplies.map((r) => r.text).join('\n\n') || 'Sin archivo multimedia adjunto.'}
                </div>
              )}

              {primaryMedia && (
                <div className="flex items-center justify-between gap-4 flex-wrap text-xs text-[#575A61] pt-2 border-t border-[#EFEFEA]">
                  <span>{primaryMedia.note}</span>
                  <span className="font-mono tabular-nums">Total: {formatBytes(totalBytes)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Columna derecha: Pie de foto de WhatsApp + Comentarios */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#141517]">Mensaje para WhatsApp</h2>
                {captionText && (
                  <button
                    type="button"
                    onClick={() => handleCopyCaption(captionText)}
                    className="px-2.5 py-1 rounded-md border border-[#E5E5E0] hover:bg-[#F7F7F5] text-xs font-medium text-[#3F4248] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedCaption ? <Check className="w-3.5 h-3.5 text-[#146C43]" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCaption ? 'Copiado' : 'Copiar texto'}
                  </button>
                )}
              </div>

              <div className="rounded-lg bg-[#F2F7F4] border border-[#D8E8DF] p-4 text-sm text-[#141517] whitespace-pre-wrap leading-relaxed">
                {captionText || 'Sin pie de foto generado.'}
              </div>

              {noticeReplies.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {noticeReplies.map((n, idx) => (
                    <p key={idx} className="text-xs text-[#575A61] leading-relaxed">
                      {n.text}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {commentsReply && (
              <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-[#141517]">Top comentarios</h2>
                {commentsReply.comments && commentsReply.comments.length > 0 ? (
                  <ol className="divide-y divide-[#EFEFEA]">
                    {commentsReply.comments.map((c, idx) => (
                      <li key={idx} className="py-3 first:pt-0 last:pb-0 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-[#141517] truncate">
                            {idx + 1}. {c.author}
                          </span>
                          <span className="font-mono tabular-nums text-[#575A61] shrink-0">
                            {c.likes.toLocaleString('es-MX')} likes
                          </span>
                        </div>
                        <p className="text-xs text-[#3F4248] leading-relaxed">{c.text}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-[#575A61] leading-relaxed">{commentsReply.text}</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Estado inicial vacío */}
      {!loading && !result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5">
            <h2 className="text-base font-semibold text-[#141517]">5 plataformas compatibles</h2>
            <p className="mt-1.5 text-sm text-[#575A61] leading-relaxed">
              YouTube (videos y Shorts), X (incluye fotos múltiples y tweets citados), Instagram Reels, TikTok y Reddit.
            </p>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5">
            <h2 className="text-base font-semibold text-[#141517]">Compresión inteligente FFmpeg</h2>
            <p className="mt-1.5 text-sm text-[#575A61] leading-relaxed">
              Ajusta automáticamente el bitrate (hasta 4 intentos) para encajar debajo de 16 MB en WhatsApp o envía en
              HD como documento.
            </p>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5">
            <h2 className="text-base font-semibold text-[#141517]">Audio y recortes al vuelo</h2>
            <p className="mt-1.5 text-sm text-[#575A61] leading-relaxed">
              Extrae solo el MP3 de videos largos o recorta un tramo exacto como <span className="font-mono text-xs">0:15-0:45</span> antes
              de descargar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
