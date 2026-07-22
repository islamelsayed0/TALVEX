import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = ComponentProps<typeof ClerkProvider>["appearance"];

/**
 * The Talvex visual language applied to every Clerk component through the
 * appearance prop (docs/design/README.md). All color values are CSS custom
 * properties from globals.css, so Clerk follows the theme toggle for free.
 *
 * Two deliberate rulings live here:
 * - The Google button is the ONLY accent element on an auth screen. The
 *   email path stays neutral so blue reads as "the one recommended action".
 * - Google's branding guidelines require the standard multicolor G on a
 *   white tile; Clerk already serves the official asset, and we keep it.
 *   This is the sanctioned exception to the "no green, amber, or red" rule,
 *   because it is Google's mark, not our palette.
 *
 * Errors render in the calm muted tone, never red (the reference's error
 * state reassures, it does not alarm). Red stays reserved for status
 * meaning in Phase 1 features.
 *
 * Element level treatments (buttons, fields, org rows) live in globals.css
 * under "@layer components", NOT in an elements object here. Clerk injects
 * its own styles into the lower "clerk" cascade layer (cssLayerName below),
 * so rules in the components layer always win, while appearance element
 * styles land inside the clerk layer and lose ties against Clerk's internal
 * recipes (verified against the rendered DOM: border, box shadow, and width
 * overrides were dropped).
 */
export const clerkAppearance = {
  cssLayerName: "clerk",
  options: {
    socialButtonsVariant: "blockButton",
    socialButtonsPlacement: "top",
    elevation: "flush",
    logoPlacement: "none",
  },
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--field-bg)",
    colorInputForeground: "var(--field-text)",
    colorBorder: "var(--input)",
    colorNeutral: "var(--foreground)",
    colorRing: "var(--ring)",
    colorDanger: "var(--muted-foreground)",
    colorSuccess: "var(--muted-foreground)",
    colorWarning: "var(--muted-foreground)",
    fontFamily: "var(--font-geist-sans)",
    fontFamilyButtons: "var(--font-geist-sans)",
    fontSize: "14px",
    borderRadius: "11px",
  },
} satisfies Appearance;
