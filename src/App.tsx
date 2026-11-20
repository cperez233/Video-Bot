import { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import type { ActivityEntry, BotConfig, BotStatus, EnvCapabilities, TabId } from './types';
import { Sidebar } from './components/Sidebar';
import { ExtractorView } from './components/ExtractorView';
import { WhatsAppBotView } from './components/WhatsAppBotView';
import { ConfigView } from './components/ConfigView';
import { ActivityView } from './components/ActivityView';

const TAB_LABELS: Record<TabId, string> = {
  extractor: 'Extractor web',
  bot: 'Bot de WhatsApp',
  config: 'Configuración',
  activity: 'Actividad y comandos',
};

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('extractor');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [capabilities, setCapabilities] = useState<EnvCapabilities | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [cacheSize, setCacheSize] = useState(0);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = (await res.json()) as BotStatus;
        setBotStatus(data);
        setCacheSize(data.cacheSize);
      }
    } catch {
      // ignore transient poll error
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) setConfig((await res.json()) as BotConfig);
    } catch {
      // ignore
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/activity');
      if (res.ok) {
        const data = (await res.json()) as { entries: ActivityEntry[]; cacheSize: number };
        setActivity(data.entries);
        setCacheSize(data.cacheSize);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.capabilities) setCapabilities(data.capabilities as EnvCapabilities);
      })
      .catch(() => {});
    fetchStatus();
    fetchConfig();
    fetchActivity();
  }, [fetchActivity, fetchConfig, fetchStatus]);

  // Polling ligero para reflejar cambios de QR, Pairing Code y conexión de WhatsApp en tiempo real
  useEffect(() => {
    const isTransitioning =
      botStatus?.state === 'connecting' || botStatus?.state === 'qr' || botStatus?.state === 'pairing';
    const intervalMs = isTransitioning ? 2000 : activeTab === 'bot' ? 5000 : 12000;
    const timer = setInterval(() => {
      fetchStatus();
      if (activeTab === 'activity') fetchActivity();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [activeTab, botStatus?.state, fetchActivity, fetchStatus]);

  async function handleClearCache() {
    await fetch('/api/cache', { method: 'DELETE' });
    await Promise.all([fetchActivity(), fetchStatus()]);
  }

  const botConnected = botStatus?.state === 'connected';

  return (
    <div className="min-h-screen flex bg-[#F7F7F5] text-[#141517]">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        botStatus={botStatus}
        capabilities={capabilities}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 bg-[#FFFFFF]/95 backdrop-blur-xs border-b border-[#E5E5E0] px-4 sm:px-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Abrir menú de navegación"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#3F4248] hover:bg-[#F7F7F5] shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span className="font-display font-semibold text-[#6B6F76] hidden sm:inline whitespace-nowrap">
                Video Bot Studio
              </span>
              <span className="text-[#B8B8B0] hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-[#141517] truncate">{TAB_LABELS[activeTab]}</span>
            </div>
          </div>

          {activeTab === 'bot' ? (
            <button
              type="button"
              onClick={() => setActiveTab('extractor')}
              className="h-9 px-4 rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F7F7F5] text-xs font-semibold text-[#141517] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Ir al extractor
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab('bot')}
              className={`h-9 px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                botConnected
                  ? 'bg-[#F2F7F4] border border-[#CFE4D8] text-[#0F5334] hover:bg-[#E6F1EB]'
                  : 'bg-[#146C43] hover:bg-[#0F5334] text-white'
              }`}
            >
              {botConnected ? 'WhatsApp conectado' : 'Vincular WhatsApp'}
            </button>
          )}
        </header>

        <main className="flex-1 w-full max-w-[1160px] mx-auto px-4 sm:px-8 py-8">
          {activeTab === 'extractor' && (
            <ExtractorView
              capabilities={capabilities}
              onExtracted={() => {
                fetchActivity();
                fetchStatus();
              }}
            />
          )}

          {activeTab === 'bot' && (
            <WhatsAppBotView
              status={botStatus}
              onRefresh={fetchStatus}
              onGoConfig={() => setActiveTab('config')}
            />
          )}

          {activeTab === 'config' && (
            <ConfigView
              config={config}
              onSaved={(updated) => {
                setConfig(updated);
                fetchStatus();
              }}
            />
          )}

          {activeTab === 'activity' && (
            <ActivityView
              entries={activity}
              cacheSize={cacheSize}
              onClearCache={handleClearCache}
              onGoExtractor={() => setActiveTab('extractor')}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
