import { useState, type FormEvent } from 'react';
import { QrCode, Smartphone, Power, LogOut, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import type { BotStatus } from '../types';
import { botStateLabel, formatTime, normalizePhonePreview } from '../utils/format';

interface WhatsAppBotViewProps {
  status: BotStatus | null;
  onRefresh: () => Promise<void>;
  onGoConfig: () => void;
}

export function WhatsAppBotView({ status, onRefresh, onGoConfig }: WhatsAppBotViewProps) {
  const [linkMethod, setLinkMethod] = useState<'qr' | 'pairing'>('qr');
  const [pairingPhone, setPairingPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const state = status?.state || 'disconnected';
  const info = botStateLabel(state);
  const isActive = state === 'connected' || state === 'connecting' || state === 'qr' || state === 'pairing';
  const normalizedPreview = normalizePhonePreview(pairingPhone);

  async function handleConnectQr() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/bot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'No se pudo iniciar la sesión.');
      await onRefresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestPairing(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizedPreview || normalizedPreview.length < 8) {
      setError('Escribe tu número con código de país (mínimo 8 dígitos, ej. 523312345678).');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/bot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingPhone: normalizedPreview }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'No se pudo solicitar el Pairing Code.');
      await onRefresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setBusy(true);
    try {
      await fetch('/api/bot/disconnect', { method: 'POST' });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setError(null);
    setBusy(true);
    try {
      await fetch('/api/bot/logout', { method: 'POST' });
      setConfirmLogout(false);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-[#141517]">Bot de WhatsApp (Baileys)</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#575A61]">
            Vincula una cuenta de WhatsApp mediante código QR o código de 8 dígitos para responder automáticamente a
            enlaces en chats privados o grupos autorizados.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isActive ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleDisconnect}
              className="h-10 px-4 rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F7F7F5] text-sm font-semibold text-[#141517] inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Power className="w-4 h-4 text-[#B91C1C]" />
              Desconectar
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={handleConnectQr}
              className="h-10 px-4 rounded-lg bg-[#146C43] hover:bg-[#0F5334] text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Power className="w-4 h-4" />
              Conectar bot
            </button>
          )}
        </div>
      </div>

      {status && status.allowedCount === 0 && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-5 py-3.5 text-sm text-[#92400E] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[#B45309]" />
            <span>
              <strong>Lista blanca vacía:</strong> por seguridad el bot ignora todos los mensajes hasta que agregues al
              menos un número autorizado.
            </span>
          </div>
          <button
            type="button"
            onClick={onGoConfig}
            className="text-xs font-semibold text-[#92400E] underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Configurar números →
          </button>
        </div>
      )}

      {/* Métricas reales de sesión */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-4">
          <div className="text-xs text-[#6B6F76]">Estado actual</div>
          <div
            className={`mt-1.5 text-base font-semibold ${
              info.tone === 'green'
                ? 'text-[#15803D]'
                : info.tone === 'amber'
                  ? 'text-[#B45309]'
                  : info.tone === 'red'
                    ? 'text-[#B91C1C]'
                    : 'text-[#141517]'
            }`}
          >
            {info.label}
          </div>
        </div>
        <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-4">
          <div className="text-xs text-[#6B6F76]">Cuenta vinculada</div>
          <div className="mt-1.5 text-base font-mono font-medium text-[#141517] tabular-nums truncate">
            {status?.connectedPhone ? `+${status.connectedPhone}` : 'Sin vincular'}
          </div>
        </div>
        <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-4">
          <div className="text-xs text-[#6B6F76]">Números en lista blanca</div>
          <div className="mt-1.5 text-base font-mono font-medium text-[#141517] tabular-nums">
            {status?.allowedCount ?? 0}
          </div>
        </div>
        <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-4">
          <div className="text-xs text-[#6B6F76]">Cola · Caché</div>
          <div className="mt-1.5 text-base font-mono font-medium text-[#141517] tabular-nums">
            {status?.queueDepth ?? 0} en cola · {status?.cacheSize ?? 0} caché
          </div>
        </div>
      </div>

      {/* Área principal de vinculación y registros */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#141517]">Vinculación de dispositivo</h2>
            <div className="inline-flex p-1 bg-[#F2F2EE] rounded-lg self-start" role="tablist" aria-label="Método de vinculación">
              <button
                type="button"
                role="tab"
                aria-selected={linkMethod === 'qr'}
                onClick={() => setLinkMethod('qr')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  linkMethod === 'qr' ? 'bg-white text-[#141517] shadow-xs' : 'text-[#575A61] hover:text-[#141517]'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                Código QR
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={linkMethod === 'pairing'}
                onClick={() => setLinkMethod('pairing')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  linkMethod === 'pairing' ? 'bg-white text-[#141517] shadow-xs' : 'text-[#575A61] hover:text-[#141517]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Pairing Code (8 dígitos)
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#991B1B]">
              {error}
            </div>
          )}

          {status?.lastError && (
            <div className="rounded-lg bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-xs text-[#92400E]">
              Último aviso de conexión: {status.lastError}
            </div>
          )}

          {state === 'connected' ? (
            <div className="rounded-xl bg-[#F2F7F4] border border-[#CFE4D8] p-6 space-y-2">
              <div className="text-sm font-semibold text-[#0F5334]">Sesión activa en WhatsApp</div>
              <p className="text-sm text-[#2C4A3B]">
                Conectado como <span className="font-mono font-semibold">+{status?.connectedPhone}</span>
                {status?.connectedName ? ` (${status.connectedName})` : ''}. Envía un link desde un número en tu lista
                blanca (o en <em>Message yourself</em> si usas tu propio número) y el bot responderá en el mismo chat.
              </p>
            </div>
          ) : linkMethod === 'qr' ? (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
              <div className="sm:col-span-6 flex items-center justify-center rounded-xl border border-[#E5E5E0] bg-[#FAFAF8] p-5 min-h-[260px]">
                {status?.qrDataUrl ? (
                  <img
                    src={status.qrDataUrl}
                    alt="Código QR para vincular WhatsApp"
                    className="w-56 h-56 rounded-lg bg-white p-2 border border-[#E5E5E0]"
                  />
                ) : state === 'connecting' ? (
                  <div className="text-center space-y-2 text-xs text-[#575A61]">
                    <RefreshCw className="w-6 h-6 animate-spin text-[#146C43] mx-auto" />
                    <p>Generando código QR desde WhatsApp…</p>
                  </div>
                ) : (
                  <div className="text-center space-y-3 max-w-[200px]">
                    <QrCode className="w-10 h-10 text-[#9CA0A8] mx-auto" />
                    <p className="text-xs text-[#575A61]">
                      Pulsa <strong>Conectar con QR</strong> para generar un código temporal de WhatsApp Web.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleConnectQr}
                      className="px-4 py-2 rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F7F7F5] text-[#141517] text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Generar QR ahora
                    </button>
                  </div>
                )}
              </div>

              <ol className="sm:col-span-6 space-y-3 text-sm text-[#3F4248]">
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#146C43] mt-0.5">01</span>
                  <span>Abre WhatsApp en el teléfono (preferiblemente un número secundario).</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#146C43] mt-0.5">02</span>
                  <span>
                    Ve a <strong>Ajustes → Dispositivos vinculados → Vincular un dispositivo</strong>.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#146C43] mt-0.5">03</span>
                  <span>Escanea el QR de la izquierda; se renueva automáticamente cada ~25 segundos.</span>
                </li>
              </ol>
            </div>
          ) : (
            <form onSubmit={handleRequestPairing} className="space-y-4">
              <div>
                <label htmlFor="pairing-phone" className="block text-sm font-semibold text-[#141517] mb-1.5">
                  Número de la cuenta a vincular (con código de país)
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    id="pairing-phone"
                    type="tel"
                    value={pairingPhone}
                    onChange={(e) => setPairingPhone(e.target.value)}
                    placeholder="523312345678 o 15551234567"
                    className="flex-1 h-11 px-4 rounded-lg border border-[#D4D4CE] bg-[#FAFAF8] text-sm font-mono text-[#141517] focus:bg-white focus:border-[#146C43]"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-11 px-5 rounded-lg bg-[#146C43] hover:bg-[#0F5334] disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Generar código
                  </button>
                </div>
                {pairingPhone && (
                  <p className="mt-1.5 text-xs text-[#575A61] font-mono tabular-nums">
                    Normalizado: {normalizedPreview || '—'} (sin +, espacios ni guiones)
                  </p>
                )}
              </div>

              {status?.pairingCode && (
                <div className="rounded-xl bg-[#F2F7F4] border border-[#CFE4D8] p-5 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs font-medium text-[#2C4A3B]">Tu código de vinculación</div>
                    <div className="mt-1 text-3xl font-mono font-bold tracking-[0.18em] text-[#0F5334] tabular-nums">
                      {status.pairingCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyPairingCode(status.pairingCode!)}
                    className="px-3.5 py-2 rounded-lg bg-white border border-[#CFE4D8] text-xs font-semibold text-[#0F5334] inline-flex items-center gap-1.5 hover:bg-[#FAFAF8] cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCode ? 'Copiado' : 'Copiar código'}
                  </button>
                </div>
              )}

              <p className="text-xs text-[#575A61] leading-relaxed">
                En tu teléfono entra a <strong>WhatsApp → Dispositivos vinculados → Vincular con el número de teléfono</strong>{' '}
                e introduce el código de 8 caracteres. Ideal si abres este panel desde el mismo celular.
              </p>
            </form>
          )}

          {/* Limpiar sesión auth */}
          <div className="pt-4 border-t border-[#EFEFEA] flex items-center justify-between gap-4 flex-wrap">
            <div className="text-xs text-[#6B6F76]">
              Credenciales locales (<code className="font-mono">./auth</code>):{' '}
              <span className="font-semibold text-[#3F4248]">
                {status?.hasAuthSession ? 'guardadas en este contenedor' : 'ninguna'}
              </span>
            </div>
            {confirmLogout ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#B91C1C] font-medium">¿Borrar sesión guardada?</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-md bg-[#B91C1C] text-white text-xs font-semibold hover:bg-[#991B1B] cursor-pointer"
                >
                  Sí, borrar ./auth
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmLogout(false)}
                  className="px-3 py-1.5 rounded-md border border-[#D4D4CE] text-xs font-medium text-[#3F4248] hover:bg-[#F7F7F5] cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmLogout(true)}
                className="text-xs font-medium text-[#575A61] hover:text-[#B91C1C] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Cerrar sesión y borrar ./auth
              </button>
            )}
          </div>
        </div>

        {/* Columna derecha: Registros en vivo + Aviso de seguridad */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#141517]">Eventos de conexión</h2>
              <button
                type="button"
                onClick={() => onRefresh()}
                className="text-xs font-medium text-[#575A61] hover:text-[#141517] cursor-pointer"
              >
                Actualizar
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-[#EFEFEA] text-xs font-mono">
              {status?.logs && status.logs.length > 0 ? (
                status.logs.map((log, i) => (
                  <div key={`${log.time}-${i}`} className="py-2 first:pt-0 last:pb-0 flex gap-2.5 items-start">
                    <span className="text-[#8E929B] tabular-nums shrink-0">{formatTime(log.time)}</span>
                    <span
                      className={
                        log.level === 'error'
                          ? 'text-[#B91C1C]'
                          : log.level === 'warn'
                            ? 'text-[#B45309]'
                            : 'text-[#3F4248]'
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-[#6B6F76] font-sans">Sin eventos recientes todavía.</p>
              )}
            </div>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E5E5E0] rounded-xl p-5 space-y-2.5 text-xs text-[#575A61] leading-relaxed">
            <h2 className="text-sm font-semibold text-[#141517]">Recomendaciones de seguridad</h2>
            <p>
              Baileys usa el protocolo no oficial de WhatsApp Web. Usa siempre un <strong>número secundario</strong>{' '}
              para el bot y mantén la lista blanca activa para evitar bloqueos o respuestas no deseadas.
            </p>
            <p>
              En entornos en la nube efímeros, la carpeta <code className="font-mono">./auth</code> se reinicia si el
              contenedor duerme; para operación 24/7 despliega este mismo proyecto en un VPS o PC local.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
