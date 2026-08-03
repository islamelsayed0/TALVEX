import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { LogoMark } from "@/components/brand/logo-mark";

// Optional catch all segment so Clerk can own its own sub routes here, for
// example the factor and verification steps in the Google flow.
//
// The visual language lives in the shared Clerk appearance (wordmark and
// subhead render inside the widget header via localization); this page only
// provides the chrome around it.
export default function SignInPage() {
  return (
    <AuthShell>
      <LogoMark size={48} />
      <div className="mt-5 w-full">
        <SignIn />
      </div>
      {/* Browsewrap acceptance: notice and links, no checkbox and no stored
          timestamp. That is deliberate for the free prelaunch period and is
          recorded in docs/DECISIONS.md. Clickwrap with a recorded timestamp is
          required before there is anything to pay for. */}
      <p className="mt-[22px] text-[11.5px] leading-normal text-quiet">
        By continuing you agree to the{" "}
        <Link
          href="/terms"
          className="text-link underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="text-link underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Privacy Policy
        </Link>
        .
      </p>
      <p className="mt-3 text-[11.5px] leading-normal text-quiet">
        Protected and private. Your data stays yours.
      </p>
    </AuthShell>
  );
}
