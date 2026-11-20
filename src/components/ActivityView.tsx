import { useState } from 'react';
import { Trash2, Copy, Check, ArrowRight } from 'lucide-react';
import type { ActivityEntry } from '../types';
import { formatBytes, formatTime, platformLabel } from '../utils/format';

interface ActivityViewProps {
  entries: ActivityEntry[];
  cacheSize: number;
  onClearCache: () => Promise<void>;
  onGoExtractor: () => void;
}

const WHATSAPP_COMMANDS = [
  { syntax: 'https://youtu.be/...', desc: 'Descarga video <=720p, comprime a <16 MB + título, likes y Top 5 comentarios.' },
  { syntax: 'audio https://youtu.be/...', desc: 'Extrae solo el audio en MP3 (128 kbps), ideal para podcasts o videos largos.' },
  { syntax: 'doc https://x.com/.../status/...', desc: 'Envía el archivo original como documento sin recomprimir (hasta MAX_DOC_MB).' },
  { syntax: '0:15-0:45 https://youtu.be/...', desc: 'Recorta exactamente ese tramo con FFmpeg antes de comprimir y enviar.' },
  { syntax: 'https://x.com/... https://youtu.be/...', desc: 'Procesa múltiples links enviados dentro de un mismo mensaje.' },
  { syntax: '/allow 523312345678', desc: 'Agrega un número a la lista blanca directo desde el chat.' },
  { syntax: '/remove 523312345678', desc: 'Revoca un número de la lista blanca.' },
  { syntax: '/limit 30', desc: 'Cambia el límite de duración de video en minutos (1 a 180).' },
  { syntax: '/status', desc: 'Muestra lista blanca, límites actuales y tamaño de la caché.' },
];

export function ActivityView({ entries, cacheSize, onClearCache, onGoExtractor }: ActivityViewProps) {
  const [filter, setFilter] = useState<'all' | 'web' | 'whatsapp'>('all');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const visible = entries.filter((e) => (filter === 'all' ? true : e.source === filter));

  async function handleCopy(syntax: string) {
    try {
      await navigator.clipboard.writeText(syntax);
      setCopiedCmd(syntax);
      setTimeout(() => setCopiedCmd(null), 1500);
    } catch {
      // ignore
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await onClearCache();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-[#141517]">Actividad y comandos</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#575A61]">
            Historial de enlaces procesados desde la web o WhatsApp, estado de la caché temporal y referencia rápida de
            comandos para el chat.
          </p>
        </div>

        <button
          type="button"
          disabled={clearing || cacheSize === 0}
          onClick={handleClear}
          className="h-10 px-4 rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F7F7F5] disabled:opacity-50 text-xs font-semibold text-[#141517] inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 text-[#575A61]" />
          Vaciar caché ({cacheSize})
        </button>
      </div>

      {/* Tabla de actividad */}
      <section className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#EFEFEA] flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm font-semibold text-[#141517]">
            Historial reciente <span className="font-mono text-xs text-[#6B6F76] tabular-nums">({visible.length})</span>
          </div>
          <div className="inline-flex p-1 bg-[#F2F2EE] rounded-lg">
            {(['all', 'web', 'whatsapp'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  filter === tab ? 'bg-white text-[#141517] shadow-xs' : 'text-[#575A61] hover:text-[#141517]'
                }`}
              >
                {tab === 'all' ? 'Todos' : tab === 'web' ? 'Web' : 'WhatsApp'}
              </button>
            ))}
          </div>
        </div>

        {visible.length > 0 ? (
          <>
            {/* Vista móvil sin recorte horizontal */}
            <ul className="sm:hidden divide-y divide-[#EFEFEA]">
              {visible.map((row) => (
                <li key={row.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#141517]">
                      {platformLabel(row.platform)} · {row.source === 'web' ? 'Web' : `WA`}
                    </span>
                    <span
                      className={
                        row.status === 'ok'
                          ? 'font-semibold text-[#15803D]'
                          : row.status === 'cached'
                            ? 'font-semibold text-[#0F5334]'
                            : row.status === 'error'
                              ? 'font-semibold text-[#B91C1C]'
                              : 'font-semibold text-[#575A61]'
                      }
                    >
                      {row.status === 'ok'
                        ? 'Completado'
                        : row.status === 'cached'
                          ? 'Desde caché'
                          : row.status === 'error'
                            ? 'Con error'
                            : 'Ignorado'}
                    </span>
                  </div>
                  <p className="text-xs text-[#3F4248] line-clamp-2">{row.summary}</p>
                  <div className="text-[11px] font-mono text-[#6B6F76] truncate">{row.url}</div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#575A61] tabular-nums pt-0.5">
                    <span>{formatTime(row.timestamp)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {row.mode}
                      {row.trim ? ` (${row.trim})` : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(row.bytes)}</span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Vista escritorio en tabla densa */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#EFEFEA] text-xs text-[#6B6F76]">
                    <th className="py-3 px-5 font-semibold">Hora</th>
                    <th className="py-3 px-4 font-semibold">Origen</th>
                    <th className="py-3 px-4 font-semibold">Plataforma y detalle</th>
                    <th className="py-3 px-4 font-semibold">Modo</th>
                    <th className="py-3 px-4 font-semibold text-right">Tamaño</th>
                    <th className="py-3 px-5 font-semibold text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFEA]">
                  {visible.map((row) => (
                    <tr key={row.id} className="hover:bg-[#FAFAF8]">
                      <td className="py-3 px-5 font-mono text-xs text-[#575A61] tabular-nums whitespace-nowrap">
                        {formatTime(row.timestamp)}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#3F4248] whitespace-nowrap">
                        {row.source === 'web' ? 'Web' : `WA · ${row.sender}`}
                      </td>
                      <td className="py-3 px-4 max-w-md">
                        <div className="text-xs font-semibold text-[#141517] truncate">
                          {platformLabel(row.platform)} · {row.summary}
                        </div>
                        <div className="text-[11px] font-mono text-[#6B6F76] truncate">{row.url}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-[#3F4248] whitespace-nowrap">
                        {row.mode}
                        {row.trim ? ` (${row.trim})` : ''}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-[#3F4248] text-right tabular-nums whitespace-nowrap">
                        {formatBytes(row.bytes)}
                      </td>
                      <td className="py-3 px-5 text-xs font-semibold text-right whitespace-nowrap">
                        <span
                          className={
                            row.status === 'ok'
                              ? 'text-[#15803D]'
                              : row.status === 'cached'
                                ? 'text-[#0F5334]'
                                : row.status === 'error'
                                  ? 'text-[#B91C1C]'
                                  : 'text-[#575A61]'
                          }
                        >
                          {row.status === 'ok'
                            ? 'Completado'
                            : row.status === 'cached'
                              ? 'Desde caché'
                              : row.status === 'error'
                                ? 'Con error'
                                : 'Ignorado'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-[#575A61]">
              Aún no se han procesado enlaces en esta sesión.
            </p>
            <button
              type="button"
              onClick={onGoExtractor}
              className="px-4 py-2 rounded-lg bg-[#146C43] hover:bg-[#0F5334] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              Probar en Extractor web
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* Guía de comandos de WhatsApp */}
      <section className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[#141517]">Guía de comandos en WhatsApp</h2>
          <p className="mt-1 text-xs text-[#575A61]">
            Envía cualquiera de estos formatos desde un número autorizado (o en un grupo habilitado).
          </p>
        </div>

        <div className="divide-y divide-[#EFEFEA]">
          {WHATSAPP_COMMANDS.map((item) => (
            <div key={item.syntax} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <code className="text-xs font-mono font-semibold text-[#0F5334] break-all">{item.syntax}</code>
                <p className="text-xs text-[#575A61]">{item.desc}</p>
              </div>
              <button
                type="button"
                aria-label={`Copiar comando ${item.syntax}`}
                onClick={() => handleCopy(item.syntax)}
                className="self-start sm:self-center px-2.5 py-1 rounded-md border border-[#E5E5E0] hover:bg-[#F7F7F5] text-xs text-[#3F4248] inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {copiedCmd === item.syntax ? <Check className="w-3 h-3 text-[#146C43]" /> : <Copy className="w-3 h-3" />}
                {copiedCmd === item.syntax ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
