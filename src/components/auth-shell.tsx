/**
 * Shared chrome for the auth screens (sign in, sign up, select org): the
 * page gradient with glow and grain, and a centered column. Column width comes
 * from the reference (340px for sign in, 356px for select org). The product is
 * dark only, so there is no theme toggle.
 */
export function AuthShell({
  children,
  width = 340,
}: Readonly<{ children: React.ReactNode; width?: number }>) {
  return (
    <main className="page-auth flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
      <div
        className="relative z-10 flex max-w-full flex-col items-center text-center"
        style={{ width }}
      >
        {children}
      </div>
    </main>
  );
}
