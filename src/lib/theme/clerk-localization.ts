import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Localization = ComponentProps<typeof ClerkProvider>["localization"];

/**
 * Talvex copy inside Clerk components. Calm and human, no jargon, and no
 * hyphens anywhere (CLAUDE.md writing style). The start screen title is the
 * wordmark itself; the appearance layer gives it the wordmark treatment.
 */
export const clerkLocalization = {
  dividerText: "or use email",
  formFieldInputPlaceholder__emailAddress: "Email address",
  formFieldInputPlaceholder__password: "Password",
  signIn: {
    start: {
      title: "Talvex",
      subtitle:
        "Everything about your systems, in one calm place. Sign in to pick up where you left off.",
    },
  },
  signUp: {
    start: {
      title: "Talvex",
      subtitle:
        "One calm place for your systems. Create your account to get started.",
    },
  },
} satisfies Localization;
