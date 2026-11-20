import { Download, MessageSquare, SlidersHorizontal, Activity, X } from 'lucide-react';
import type { BotStatus, EnvCapabilities, TabId } from '../types';
import { botStateLabel } from '../utils/format';

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  botStatus: BotStatus | null;
  capabilities: EnvCapabilities | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{ id: TabId; label: string; hint: string; icon: typeof Download }> = [
  { id: 'extractor', label: 'Extractor web', hint: 'Uso directo sin WhatsApp', icon: Download },
  { id: 'bot', label: 'Bot de WhatsApp', hint: 'QR, Pairing Code y sesión', icon: MessageSquare },
  { id: 'config', label: 'Configuración', hint: 'Lista blanca y límites', icon: SlidersHorizontal },
  { id: 'activity', label: 'Actividad y comandos', hint: 'Historial, caché y guía', icon: Activity },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  botStatus,
  capabilities,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const statusInfo = botStateLabel(botStatus?.state || 'disconnected');
  const isLive = botStatus?.state === 'connected' || botStatus?.state === 'qr' || botStatus?.state === 'pairing' || botStatus?.state === 'connecting';

  const statusTextColor =
    statusInfo.tone === 'green'
      ? 'text-[#15803D]'
      : statusInfo.tone === 'amber'
        ? 'text-[#B45309]'
        : statusInfo.tone === 'red'
          ? 'text-[#B91C1C]'
          : 'text-[#575A61]';

  const dotColor =
    statusInfo.tone === 'green'
      ? 'bg-[#15803D]'
      : statusInfo.tone === 'amber'
        ? 'bg-[#D97706]'
        : 'bg-[#B91C1C]';

  const content = (
    <div className="flex h-full flex-col justify-between bg-[#FFFFFF] border-r border-[#E5E5E0]">
      <div>
        <div className="flex items-center justify-between px-6 h-16 border-b border-[#E5E5E0]">
          <a
            href="#extractor"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab('extractor');
              onCloseMobile();
            }}
            className="font-display text-[17px] font-bold tracking-tight text-[#141517] whitespace-nowrap shrink-0"
          >
            Video Bot Studio
          </a>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Cerrar menú de navegación"
            className="lg:hidden p-2 -mr-2 text-[#575A61] hover:text-[#141517] rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Navegación principal" className="p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-start gap-3 px-3.5 py-2.5 rounded-lg text-left transition-colors ${
                  active
                    ? 'bg-[#146C43]/10 text-[#0F5334]'
                    : 'text-[#3F4248] hover:bg-[#F7F7F5] hover:text-[#141517]'
                }`}
              >
                <Icon className={`w-[18px] h-[18px] mt-0.5 shrink-0 ${active ? 'text-[#146C43]' : 'text-[#71757D]'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-5 whitespace-nowrap truncate">{item.label}</span>
                  <span className="block text-xs text-[#6B6F76] leading-4 mt-0.5 truncate">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-5 border-t border-[#E5E5E0] space-y-3 text-xs">
        <div>
          <div className="text-[#6B6F76] font-medium">Sesión de WhatsApp</div>
          <div className={`mt-1 flex items-center gap-2 font-semibold ${statusTextColor}`}>
            {isLive && <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />}
            <span>{statusInfo.label}</span>
          </div>
          {botStatus?.connectedPhone && (
            <div className="mt-0.5 font-mono text-[11px] text-[#575A61] tabular-nums">
              +{botStatus.connectedPhone}
            </div>
          )}
        </div>

        {capabilities && (
          <div className="pt-3 border-t border-[#EFEFEA] text-[#6B6F76] flex items-center gap-2 flex-wrap font-mono text-[11px]">
            <span>FFmpeg: {capabilities.ffmpeg ? 'listo' : 'falta'}</span>
            <span aria-hidden="true">·</span>
            <span>yt-dlp: {capabilities.ytdlp ? 'listo' : 'falta'}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full shadow-xl">{content}</div>
          <button
            type="button"
            aria-label="Cerrar fondo de menú"
            className="flex-1 bg-black/30"
            onClick={onCloseMobile}
          />
        </div>
      )}
    </>
  );
}
