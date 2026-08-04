/**
 * The Talvext wordmark: title case, Geist 600, tight letter spacing.
 * "lg" is the sign in treatment (27px); "sm" is the dashboard header brand
 * (20px, the --text-brand token).
 */
export function Wordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <span
      className={
        size === "lg"
          ? "text-wordmark text-foreground"
          : "text-brand text-foreground"
      }
    >
      Talvext
    </span>
  );
}
