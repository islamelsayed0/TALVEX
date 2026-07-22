/**
 * The Talvex wordmark: title case, Geist 600, tight letter spacing.
 * "lg" is the sign in treatment (27px), "sm" fits the dashboard header.
 */
export function Wordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <span
      className={
        size === "lg"
          ? "text-wordmark text-foreground"
          : "text-[16px] font-semibold tracking-[-0.022em] text-foreground"
      }
    >
      Talvex
    </span>
  );
}
