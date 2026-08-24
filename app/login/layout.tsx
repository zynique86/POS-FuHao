// Login page has no auth guard — that would be a chicken-and-egg problem.
// This nested layout bypasses the root AuthGuard by rendering children directly.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
