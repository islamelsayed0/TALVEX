import { SignUp } from "@clerk/nextjs";

import { AuthShell } from "@/components/auth-shell";
import { LogoMark } from "@/components/brand/logo-mark";

export default function SignUpPage() {
  return (
    <AuthShell>
      <LogoMark size={48} />
      <div className="mt-5 w-full">
        <SignUp />
      </div>
      <p className="mt-[22px] text-[11.5px] leading-normal text-quiet">
        Protected and private. Your data stays yours.
      </p>
    </AuthShell>
  );
}
