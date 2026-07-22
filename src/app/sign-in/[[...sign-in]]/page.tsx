import { SignIn } from "@clerk/nextjs";

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
      <p className="mt-[22px] text-[11.5px] leading-normal text-quiet">
        Protected and private. Your data stays yours.
      </p>
    </AuthShell>
  );
}
