'use client';

// A numeric PIN pad (0–9) with cancel + verify. Used to gate admin
// entry and privileged actions. Reusable — pass onVerify to consume.

import { useState } from 'react';

export default function PinPad({
  title,
  sub,
  onCancel,
  onVerify,
  verifyLabel = 'Enter',
}: {
  title: string;
  sub?: string;
  onCancel?: () => void;
  onVerify: (pin: string) => Promise<string | null>; // return error message or null
  verifyLabel?: string;
}) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function press(d: string) {
    if (busy) return;
    setErr(null);
    if (pin.length < 8) setPin(pin + d);
  }
  function back() {
    if (busy) return;
    setErr(null);
    setPin(pin.slice(0, -1));
  }
  async function submit() {
    if (busy || pin.length < 3) return;
    setBusy(true);
    const e = await onVerify(pin);
    if (e) {
      setErr(e);
      setPin('');
    }
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--ink-900)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl max-w-xs w-full p-6 animate-rise"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">🔒</div>
          <h2 className="text-xl font-bold text-[var(--ink-900)]">{title}</h2>
          {sub && <p className="text-xs text-[var(--ink-500)] mt-1">{sub}</p>}
        </div>

        {/* Dots showing pin length */}
        <div className="flex justify-center gap-2 mb-2 h-8 items-center">
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span
              key={i}
              className={`w-3 h-3 rounded-full transition ${
                i < pin.length ? 'bg-[var(--brand-600)]' : 'bg-[var(--ink-200)]'
              }`}
            />
          ))}
        </div>

        {err && (
          <p className="text-center text-sm text-[var(--brand-700)] bg-[var(--brand-50)] rounded-xl py-2 mb-3">
            {err}
          </p>
        )}

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              onClick={() => press(d)}
              className="py-4 rounded-xl bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-2xl font-bold text-[var(--ink-900)]"
            >
              {d}
            </button>
          ))}
          <button
            onClick={back}
            className="py-4 rounded-xl bg-[var(--ink-100)] hover:bg-[var(--ink-200)] text-lg font-bold text-[var(--ink-700)]"
          >
            ⌫
          </button>
          <button
            onClick={() => press('0')}
            className="py-4 rounded-xl bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-2xl font-bold text-[var(--ink-900)]"
          >
            0
          </button>
          <button
            onClick={submit}
            disabled={busy || pin.length < 3}
            className="py-4 rounded-xl text-white font-bold disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            }}
          >
            ✓
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={busy}
              className="w-full py-2 text-sm text-[var(--ink-500)] hover:text-[var(--brand-600)] font-semibold"
            >
              Cancel
            </button>
          )}
        </div>

        {busy && (
          <p className="text-center text-xs text-[var(--ink-400)] mt-2">Checking…</p>
        )}
        {!busy && (
          <p className="text-center text-xs text-[var(--ink-400)] mt-2">
            Press ✓ when done · {verifyLabel}
          </p>
        )}
      </div>
    </div>
  );
}
