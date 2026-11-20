import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2, Check, KeyRound } from 'lucide-react';
import type { BotConfig } from '../types';
import { normalizePhonePreview } from '../utils/format';

interface ConfigViewProps {
  config: BotConfig | null;
  onSaved: (cfg: BotConfig) => void;
}

export function ConfigView({ config, onSaved }: ConfigViewProps) {
  const [allowedNumbers, setAllowedNumbers] = useState<string[]>([]);
  const [newNumber, setNewNumber] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);

  const [allowGroups, setAllowGroups] = useState(false);
  const [allowedGroups, setAllowedGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState('');

  const [maxDurationMin, setMaxDurationMin] = useState(20);
  const [maxDocMb, setMaxDocMb] = useState(100);
  const [cookiesText, setCookiesText] = useState('');
  const [hasCookies, setHasCookies] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    setAllowedNumbers(config.allowedNumbers);
    setAllowedGroups(config.allowedGroups);
    setAllowGroups(config.allowGroups);
    setMaxDurationMin(config.maxDurationMin);
    setMaxDocMb(config.maxDocMb);
    setHasCookies(config.hasCookies);
  }, [config]);

  const normalizedNew = normalizePhonePreview(newNumber);

  async function savePatch(patch: Record<string, unknown>, message: string) {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo guardar la configuración.');
      } else {
        onSaved(data as BotConfig);
        setSavedMsg(message);
        setTimeout(() => setSavedMsg(null), 2500);
      }
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNumber(e: FormEvent) {
    e.preventDefault();
    setNumberError(null);
    if (!normalizedNew || normalizedNew.length < 8) {
      setNumberError('Ingresa un número válido con código de país (al menos 8 dígitos).');
      return;
    }
    if (allowedNumbers.includes(normalizedNew)) {
      setNumberError('Ese número ya está en la lista blanca.');
      return;
    }
    const next = [...allowedNumbers, normalizedNew];
    setAllowedNumbers(next);
    setNewNumber('');
    await savePatch({ allowedNumbers: next }, `Número ${normalizedNew} añadido a la lista blanca.`);
  }

  async function handleRemoveNumber(num: string) {
    const next = allowedNumbers.filter((n) => n !== num);
    setAllowedNumbers(next);
    await savePatch({ allowedNumbers: next }, `Número ${num} eliminado.`);
  }

  async function handleAddGroup(e: FormEvent) {
    e.preventDefault();
    const g = newGroup.trim();
    if (!g) return;
    const formatted = g.endsWith('@g.us') ? g : `${g}@g.us`;
    if (allowedGroups.includes(formatted)) return;
    const next = [...allowedGroups, formatted];
    setAllowedGroups(next);
    setNewGroup('');
    await savePatch({ allowedGroups: next, allowGroups }, 'Grupo autorizado añadido.');
  }

  async function handleRemoveGroup(groupJid: string) {
    const next = allowedGroups.filter((g) => g !== groupJid);
    setAllowedGroups(next);
    await savePatch({ allowedGroups: next }, 'Grupo eliminado.');
  }

  async function handleSaveLimits(e: FormEvent) {
    e.preventDefault();
    await savePatch(
      {
        allowGroups,
        maxDurationMin,
        maxDocMb,
      },
      'Límites y permisos guardados en caliente.',
    );
  }

  async function handleSaveCookies() {
    if (!cookiesText.trim()) return;
    await savePatch({ cookiesText: cookiesText.trim() }, 'Cookies de YouTube guardadas.');
    setCookiesText('');
  }

  async function handleClearCookies() {
    await savePatch({ cookiesText: '' }, 'Cookies eliminadas.');
  }

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-[#141517]">Configuración en caliente</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#575A61]">
          Administra los números autorizados, el soporte de grupos, los límites de compresión y las cookies de YouTube
          sin reiniciar el servidor ni editar <code className="font-mono text-xs">.env</code> a mano.
        </p>
      </div>

      {savedMsg && (
        <div role="status" className="rounded-lg bg-[#F2F7F4] border border-[#CFE4D8] px-4 py-3 text-sm text-[#0F5334] flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Lista blanca */}
        <section className="lg:col-span-7 bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-[#141517]">Lista blanca (ALLOWED_NUMBERS)</h2>
            <p className="mt-1 text-xs text-[#575A61]">
              Solo estos números reciben respuesta en chats 1:1. Los números de México <span className="font-mono">521…</span> se
              normalizan automáticamente a <span className="font-mono">52…</span>.
            </p>
          </div>

          <form onSubmit={handleAddNumber} className="space-y-2">
            <label htmlFor="new-allowed-number" className="block text-xs font-semibold text-[#3F4248]">
              Agregar número con código de país
            </label>
            <div className="flex gap-2.5">
              <input
                id="new-allowed-number"
                type="tel"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="+52 1 33 1234 5678 o 15551234567"
                className="flex-1 h-10 px-3.5 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-sm font-mono text-[#141517] focus:bg-white focus:border-[#146C43]"
              />
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-4 rounded-lg bg-[#146C43] hover:bg-[#0F5334] text-white text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Agregar
              </button>
            </div>
            {newNumber && (
              <p className="text-xs text-[#6B6F76] font-mono tabular-nums">
                Se guardará como: {normalizedNew || '—'}
              </p>
            )}
            {numberError && <p className="text-xs text-[#B91C1C]">{numberError}</p>}
          </form>

          {allowedNumbers.length > 0 ? (
            <ul className="divide-y divide-[#EFEFEA] border-t border-[#EFEFEA]">
              {allowedNumbers.map((num) => (
                <li key={num} className="py-2.5 flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-[#141517] tabular-nums">+{num}</span>
                  <button
                    type="button"
                    aria-label={`Eliminar número ${num}`}
                    onClick={() => handleRemoveNumber(num)}
                    className="p-1.5 rounded-md text-[#6B6F76] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-[#FAFAF8] border border-[#E5E5E0] px-4 py-4 text-xs text-[#575A61]">
              Aún no hay números autorizados. Agrega el tuyo arriba para habilitar el bot en WhatsApp.
            </div>
          )}

          {/* Grupos */}
          <div className="pt-5 border-t border-[#EFEFEA] space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-[#141517]">Soporte para grupos</h3>
                <p className="mt-0.5 text-xs text-[#575A61]">
                  Cuando está activo, el bot responde en grupos donde un usuario autorizado envíe un link o lo mencione.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#141517] cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={allowGroups}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllowGroups(checked);
                    savePatch({ allowGroups: checked }, checked ? 'Soporte para grupos activado.' : 'Grupos desactivados.');
                  }}
                  className="w-4 h-4 accent-[#146C43]"
                />
                <span>Activar grupos</span>
              </label>
            </div>

            {allowGroups && (
              <div className="space-y-3">
                <form onSubmit={handleAddGroup} className="flex gap-2.5">
                  <input
                    type="text"
                    aria-label="ID de grupo de WhatsApp opcional"
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    placeholder="Opcional: 120363012345678901@g.us"
                    className="flex-1 h-9 px-3 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-xs font-mono text-[#141517] focus:bg-white focus:border-[#146C43]"
                  />
                  <button
                    type="submit"
                    className="h-9 px-3.5 rounded-lg border border-[#D4D4CE] hover:bg-[#F7F7F5] text-xs font-semibold text-[#141517] whitespace-nowrap cursor-pointer"
                  >
                    Añadir grupo
                  </button>
                </form>
                {allowedGroups.length > 0 ? (
                  <ul className="divide-y divide-[#EFEFEA]">
                    {allowedGroups.map((g) => (
                      <li key={g} className="py-2 flex items-center justify-between gap-2 text-xs font-mono">
                        <span className="text-[#3F4248] truncate">{g}</span>
                        <button
                          type="button"
                          aria-label={`Eliminar grupo ${g}`}
                          onClick={() => handleRemoveGroup(g)}
                          className="p-1 text-[#6B6F76] hover:text-[#B91C1C] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[#6B6F76]">
                    Sin grupos específicos listados: responderá en cualquier grupo cuando escriba alguien de tu lista
                    blanca o mencionen al bot.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Límites y Cookies */}
        <div className="lg:col-span-5 space-y-6">
          <form onSubmit={handleSaveLimits} className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#141517]">Límites multimedia</h2>
            <div>
              <label htmlFor="max-duration-min" className="block text-xs font-semibold text-[#3F4248] mb-1.5">
                Duración máxima de video (minutos)
              </label>
              <input
                id="max-duration-min"
                type="number"
                min={1}
                max={180}
                value={maxDurationMin}
                onChange={(e) => setMaxDurationMin(Number(e.target.value))}
                className="w-full h-10 px-3.5 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-sm font-mono tabular-nums text-[#141517] focus:bg-white focus:border-[#146C43]"
              />
              <p className="mt-1 text-xs text-[#6B6F76]">
                En modo <span className="font-mono">audio</span> o con recorte <span className="font-mono">mm:ss-mm:ss</span> se
                permiten videos más largos.
              </p>
            </div>

            <div>
              <label htmlFor="max-doc-mb" className="block text-xs font-semibold text-[#3F4248] mb-1.5">
                Tamaño máximo como documento (MB)
              </label>
              <input
                id="max-doc-mb"
                type="number"
                min={5}
                max={500}
                value={maxDocMb}
                onChange={(e) => setMaxDocMb(Number(e.target.value))}
                className="w-full h-10 px-3.5 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-sm font-mono tabular-nums text-[#141517] focus:bg-white focus:border-[#146C43]"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full h-10 rounded-lg bg-[#146C43] hover:bg-[#0F5334] text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              Guardar límites
            </button>
          </form>

          <section className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#141517] flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#146C43]" />
                Cookies de YouTube (cookies.txt)
              </h2>
              <span className={`text-xs font-semibold ${hasCookies ? 'text-[#15803D]' : 'text-[#6B6F76]'}`}>
                {hasCookies ? 'Activas' : 'No configuradas'}
              </span>
            </div>
            <p className="text-xs text-[#575A61] leading-relaxed">
              Si YouTube responde con error 429 o pide verificar que no eres bot, pega aquí el contenido de tu archivo{' '}
              <code className="font-mono">cookies.txt</code> en formato Netscape.
            </p>
            <textarea
              aria-label="Contenido de cookies.txt"
              rows={4}
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              placeholder="# Netscape HTTP Cookie File..."
              className="w-full p-3 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-xs font-mono text-[#141517] focus:bg-white focus:border-[#146C43]"
            />
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={saving || !cookiesText.trim()}
                onClick={handleSaveCookies}
                className="px-4 py-2 rounded-lg bg-[#141517] hover:bg-[#2C2E33] disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Guardar cookies
              </button>
              {hasCookies && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleClearCookies}
                  className="px-3.5 py-2 rounded-lg border border-[#D4D4CE] hover:bg-[#FEF2F2] hover:text-[#B91C1C] text-xs font-medium text-[#3F4248] transition-colors cursor-pointer"
                >
                  Eliminar cookies
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
