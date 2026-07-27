import localFont from 'next/font/local'

/**
 * General Sans is the display face for the landing page headings (the body
 * stays Geist). Self hosted via next/font/local so there is no runtime call to
 * a font CDN; the woff2 files sit next to this module. Exposes the
 * --font-general-sans variable, mapped to the `font-display` utility in
 * globals.css (@theme inline).
 */
export const generalSans = localFont({
  src: [
    { path: './GeneralSans-400.woff2', weight: '400', style: 'normal' },
    { path: './GeneralSans-500.woff2', weight: '500', style: 'normal' },
    { path: './GeneralSans-600.woff2', weight: '600', style: 'normal' },
    { path: './GeneralSans-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-general-sans',
  display: 'swap',
})
