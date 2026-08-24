// Kept as a pass-through layout only so old imports don't break.
// The root AuthGuard now detects the /login route and skips its
// checks there, so this file no longer has a real job.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
