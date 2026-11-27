'use client';

// Shared UI primitives — importing these keeps every screen visually
// consistent (headers, modals, buttons, form fields, empty states).

import { useEffect, useRef, useState } from 'react';

// ─── page header ──────────────────────────────────────────────────────────

// Admin subpage header — same look but with a "← Dashboard" back link
// in place of the role label. Title is English only.
export function AdminPageHeader({
  title,
  sub,
  right,
  backHref = '/admin',
  backLabel = '← Dashboard',
}: {
  title: string;
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

// ─── file upload ──────────────────────────────────────────────────────────

// A clearly visible upload area in place of the browser's plain
// "Choose file / No file chosen" control. Still a real <input type="file">
// underneath (visually hidden), so tap-to-pick on phones, keyboard focus and
// the `accept` filter all behave as before. Desktop users can also drag a
// file onto the area. Controlled: pass the chosen file back in via `file`,
// and pass null to clear it (the hidden input is reset too).
export function FileUpload({
  label,
  hint,
  file,
  onChange,
  accept,
  buttonText = 'Upload file',
  icon = '📎',
}: {
  label: string;
  hint?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  buttonText?: string;
  icon?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = '';
  }, [file]);

  function accepts(f: File) {
    if (!accept) return true;
    return accept.split(',').some((rule) => {
      const r = rule.trim().toLowerCase();
      if (!r) return false;
      if (r.startsWith('.')) return f.name.toLowerCase().endsWith(r);
      if (r.endsWith('/*')) return f.type.toLowerCase().startsWith(r.slice(0, -1));
      return f.type.toLowerCase() === r;
    });
  }

  const sizeKb = file ? file.size / 1024 : 0;
  const sizeText = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeKb))} KB`;

  return (
    <div className="mb-3">
      <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        {label}
      </span>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && accepts(f)) onChange(f);
        }}
        className={`flex items-center gap-3 w-full px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition focus-within:ring-4 focus-within:ring-[var(--brand-100)] ${
          dragging
            ? 'border-[var(--brand-500)] bg-[var(--brand-50)]'
            : file
            ? 'border-[var(--brand-500)] bg-white'
            : 'border-[var(--ink-300)] bg-[var(--ink-100)] hover:border-[var(--brand-500)] hover:bg-[var(--brand-50)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
        <span
          className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-white border border-[var(--ink-200)]"
          aria-hidden
        >
          {file ? '✅' : icon}
        </span>
        <span className="min-w-0 flex-1">
          {file ? (
            <>
              <span className="block text-sm font-semibold text-[var(--ink-900)] break-all line-clamp-2">{file.name}</span>
              <span className="block text-xs text-[var(--ink-500)]">{sizeText} · Tap to change</span>
            </>
          ) : (
            <>
              <span className="block text-sm font-bold text-[var(--brand-700)]">{buttonText}</span>
              <span className="block text-xs text-[var(--ink-500)]">Tap to choose a file, or drag it here</span>
            </>
          )}
        </span>
        {file && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(null);
            }}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--ink-200)] bg-white text-[var(--ink-700)] hover:bg-[var(--ink-100)]"
          >
            Remove
          </button>
        )}
      </label>
      {hint && <span className="block text-xs text-[var(--ink-400)] mt-1">{hint}</span>}
    </div>
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
