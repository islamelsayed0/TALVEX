import { SignIn } from "@clerk/nextjs";

// Optional catch all segment so Clerk can own its own sub routes here, for
// example the factor and verification steps in the Google flow.
export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
