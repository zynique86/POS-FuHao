// Admin whitelist — single source of truth.
//
// Kept in its own module (with no Supabase or app-code imports) so the
// Edge middleware can import it without pulling the browser Supabase
// client into the Edge bundle.
//
// ★  EDIT THIS LIST WHEN YOU HIRE OR PROMOTE PEOPLE  ★

export const ADMIN_EMAILS = [
  'ezjiet@gmail.com',
  'poyee4963@gmail.com',
  'rickytan5791@gmail.com',
  'tan523567@gmail.com',
] as const;

function normalise(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const needle = normalise(email);
  if (!needle) return false;
  return ADMIN_EMAILS.some((a) => normalise(a) === needle);
}
