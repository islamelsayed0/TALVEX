import { Show } from "@clerk/nextjs";
import Link from "next/link";

// Public marketing placeholder. Task 7 owns the design pass and the real
// landing page comes at the end of the MVP, so this stays deliberately plain.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Talvex</h1>
        <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
          Monitoring, incidents, ticketing, and AI support for small IT teams.
          One platform, one data model.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {/* Clerk 7 replaced the SignedIn and SignedOut components with Show. */}
        <Show when="signed-out">
          <Link
            href="/sign-in"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700"
          >
            Create account
          </Link>
        </Show>
        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Go to dashboard
          </Link>
        </Show>
      </div>

      <p className="text-xs text-gray-500">
        Phase 0 foundation. No features yet.
      </p>
    </main>
  );
}
