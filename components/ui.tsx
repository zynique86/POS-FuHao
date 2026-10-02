'use client';

// Shared UI primitives — importing these keeps every screen visually
// consistent (headers, modals, buttons, form fields, empty states).

import { useEffect } from 'react';

// ─── page header ──────────────────────────────────────────────────────────

// Main-surface header (POS, Kitchen, Bar, Cashier, Restock).
//   label   → uppercase-tracked role label, bilingual, e.g. "Waiter · 服務員"
//   title   → big page title, e.g. "Take Order"
//   sub     → optional subtitle
//   right   → optional right-side content (stat chips, controls)
export function PageHeader({
  label,
  title,
  sub,
  right,
}: {
  label?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        {label && (
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)]">
            {label}
          </p>
        )}
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-1">
          {title}
        </h1>
        {sub && <p className="text-sm text-[var(--ink-500)] mt-1">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// Admin subpage header — same look but with a "← Dashboard" back link
// in place of the role label. Title is bilingual by convention.
export function AdminPageHeader({
  title,
  titleZh,
  sub,
  right,
  backHref = '/admin',
  backLabel = '← Dashboard',
}: {
  title: string;
  titleZh?: string;
  sub?: string;
  right?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <a
          href={backHref}
          className="text-xs uppercase tracking-widest text-[var(--ink-500)] hover:text-[var(--brand-600)]"
        >
          {backLabel}
        </a>
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-2">
          {title}
          {titleZh && (
            <span className="text-[var(--ink-500)] font-normal ml-2">· {titleZh}</span>
          )}
        </h1>
        {sub && <p className="text-sm text-[var(--ink-500)] mt-1">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// ─── form field ───────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-[var(--ink-400)] mt-1">{hint}</span>
      )}
    </label>
  );
}

export const inputBase =
  'w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]';

// ─── buttons ──────────────────────────────────────────────────────────────

export function PrimaryBtn({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-white font-bold py-3 rounded-2xl transition disabled:opacity-60 ${className}`}
      style={{
        background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
        boxShadow: 'var(--shadow-brand)',
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryBtn({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold py-3 rounded-2xl transition disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function ConfirmBtn({
  children,
  onClick,
  disabled,
  busy,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-white font-bold py-3.5 rounded-2xl text-base transition disabled:opacity-60 ${className}`}
      style={{
        background: 'linear-gradient(135deg, var(--jade-500), var(--jade-600))',
        boxShadow: '0 10px 24px -8px rgb(5 150 105 / 0.35)',
      }}
    >
      {busy ? 'Recording…' : children}
    </button>
  );
}

// ─── modal shell ──────────────────────────────────────────────────────────

export function ModalShell({
  title,
  sub,
  onClose,
  children,
  maxWidth = 'max-w-md',
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  // Close on Escape.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-3xl ${maxWidth} w-full p-6 max-h-[95vh] overflow-y-auto animate-rise`}
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex justify-between items-baseline mb-5">
          <div>
            <h2 className="text-2xl font-bold text-[var(--ink-900)]">{title}</h2>
            {sub && <p className="text-xs text-[var(--ink-400)] font-mono mt-0.5">{sub}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--ink-100)] hover:bg-[var(--ink-200)] text-[var(--ink-500)] text-base flex items-center justify-center"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── inline banner / alert ────────────────────────────────────────────────

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-3 rounded-xl mb-4 text-sm">
      {children}
    </div>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────

export function EmptyState({
  emoji,
  title,
  sub,
}: {
  emoji: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="text-center py-16">
      <div className="text-6xl mb-3 opacity-40">{emoji}</div>
      <p className="text-lg text-[var(--ink-700)] font-semibold">{title}</p>
      {sub && <p className="text-sm text-[var(--ink-500)] mt-1">{sub}</p>}
    </div>
  );
}

// ─── content card ─────────────────────────────────────────────────────────

// Big content section (dashboard chart, admin form, etc.)
export function ContentCard({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`bg-white rounded-3xl border border-[var(--ink-200)] ${padded ? 'p-6 md:p-8' : ''} ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {children}
    </section>
  );
}
