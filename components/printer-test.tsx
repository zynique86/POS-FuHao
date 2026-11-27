'use client';

// "Test printers" button + modal. Inserts one `test` print job per station;
// the printer service (printer-service/index.js → processTestJob) tries to
// print a short test slip once and writes the outcome back into
// payload.result. We poll that row and show pass / fail per printer.
//
// If no result arrives within REPLY_TIMEOUT_MS the printer service itself is
// not running (or can't reach Supabase), which is reported separately from a
// printer being offline.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { PrintStation } from '@/lib/types';
import { ModalShell, PrimaryBtn, SecondaryBtn } from '@/components/ui';

// The service gives a printer up to ~15s to answer, so wait a bit longer.
const REPLY_TIMEOUT_MS = 30_000;
const POLL_MS = 1_000;

const STATIONS: { key: PrintStation; label: string; sub: string }[] = [
  { key: 'cashier', label: 'Cashier / Front Kitchen', sub: 'Receipts, dim sum, buns, roasted' },
  { key: 'kitchen', label: 'Back Kitchen', sub: 'Noodles, fried, rice' },
  { key: 'bar', label: 'Bar', sub: 'Drinks' },
];

type TestResult = { ok: boolean; error?: string; ip?: string | null; expired?: boolean };

type RowState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'ok'; ip?: string | null }
  | { kind: 'fail'; error: string; ip?: string | null };

const IDLE: Record<PrintStation, RowState> = {
  cashier: { kind: 'idle' },
  kitchen: { kind: 'idle' },
  bar: { kind: 'idle' },
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTest(station: PrintStation, by: string, alive: () => boolean): Promise<RowState> {
  const { data, error } = await supabase
    .from('print_jobs')
    .insert({ kind: 'test', station, payload: { by } })
    .select('id')
    .single();
  if (error || !data) {
    return { kind: 'fail', error: `Could not send the test: ${error?.message ?? 'unknown error'}` };
  }

  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline && alive()) {
    await sleep(POLL_MS);
    const { data: row } = await supabase
      .from('print_jobs')
      .select('printed_at, payload')
      .eq('id', data.id)
      .single();
    const result = (row?.payload as { result?: TestResult } | null)?.result;
    if (row?.printed_at && result) {
      return result.ok
        ? { kind: 'ok', ip: result.ip }
        : { kind: 'fail', error: result.error || 'Print failed', ip: result.ip };
    }
  }

  // Close the job so a late-starting service doesn't print a stale slip
  // (the service also skips test jobs older than 2 minutes).
  await supabase
    .from('print_jobs')
    .update({ printed_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('printed_at', null);
  return {
    kind: 'fail',
    error:
      'No reply from the printer service. Check the printer service is running on the cashier laptop and the laptop is online.',
  };
}

export function PrinterTestButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-2xl bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold text-sm transition"
      >
        🖨️ Test printers
      </button>
      {open && <PrinterTestModal onClose={() => setOpen(false)} />}
    </>
  );
}

function PrinterTestModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Record<PrintStation, RowState>>(IDLE);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = Object.values(rows).some((r) => r.kind === 'waiting');

  async function test(stations: PrintStation[]) {
    setRows((prev) => {
      const next = { ...prev };
      for (const s of stations) next[s] = { kind: 'waiting' };
      return next;
    });
    const { data: userRes } = await supabase.auth.getUser();
    const by = userRes?.user?.email ?? 'staff';
    await Promise.all(
      stations.map(async (s) => {
        const r = await runTest(s, by, () => mounted.current);
        if (mounted.current) setRows((prev) => ({ ...prev, [s]: r }));
      })
    );
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Test printers"
      sub="Prints a short test slip. Check that each slip comes out."
      maxWidth="max-w-lg"
    >
      <div className="space-y-3 mb-5">
        {STATIONS.map((s) => (
          <StationRow
            key={s.key}
            label={s.label}
            sub={s.sub}
            state={rows[s.key]}
            onTest={() => test([s.key])}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SecondaryBtn onClick={onClose}>Close</SecondaryBtn>
        <PrimaryBtn onClick={() => test(STATIONS.map((s) => s.key))} disabled={busy}>
          {busy ? 'Testing…' : 'Test all printers'}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

function StationRow({
  label,
  sub,
  state,
  onTest,
}: {
  label: string;
  sub: string;
  state: RowState;
  onTest: () => void;
}) {
  const tone =
    state.kind === 'ok'
      ? 'border-[var(--jade-600)] bg-[var(--jade-100)]'
      : state.kind === 'fail'
        ? 'border-[var(--brand-500)] bg-[var(--brand-50)]'
        : 'border-[var(--ink-100)] bg-white';
  return (
    <div className={`border-2 rounded-2xl p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-[var(--ink-900)]">{label}</p>
          <p className="text-xs text-[var(--ink-500)]">
            {sub}
            {'ip' in state && state.ip ? ` · ${state.ip}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge state={state} />
          <button
            type="button"
            onClick={onTest}
            disabled={state.kind === 'waiting'}
            className="px-3 py-1.5 rounded-xl bg-[var(--ink-100)] hover:bg-[var(--ink-200)] text-[var(--ink-800)] text-sm font-bold disabled:opacity-50"
          >
            Test
          </button>
        </div>
      </div>
      {state.kind === 'fail' && (
        <p className="mt-2 text-sm text-[var(--brand-700)]">{state.error}</p>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: RowState }) {
  switch (state.kind) {
    case 'idle':
      return <span className="text-xs text-[var(--ink-400)]">Not tested</span>;
    case 'waiting':
      return <span className="text-xs font-bold text-[var(--gold-600)]">Printing…</span>;
    case 'ok':
      return <span className="text-xs font-bold text-[var(--jade-600)]">✓ Working</span>;
    case 'fail':
      return <span className="text-xs font-bold text-[var(--brand-700)]">✕ Failed</span>;
  }
}
