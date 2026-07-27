'use client'

import { useEffect, useRef } from 'react'

/**
 * The fixed background video behind the landing page, plus the vignette that
 * keeps text legible over it.
 *
 * The video is visible by default and shows a poster frame until it decodes, so
 * the hero is never black: if the browser cannot autoplay or decode the video,
 * the poster stands in. Visibility is never gated on a JS event.
 *
 * Muting is guaranteed three ways: the `muted` attribute, a reassert on mount,
 * and the volume pinned to 0. There is no audio track we ever want to hear.
 */
export function HeroBackground() {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true
    v.volume = 0
    // Browsers may defer autoplay; nudge it and ignore a blocked-autoplay reject.
    v.play().catch(() => {})
  }, [])

  return (
    <>
      <video
        ref={ref}
        className="landing-hero-video"
        poster="/landing/hero-poster.jpg"
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        aria-hidden
      >
        <source src="/landing/hero.mp4" type="video/mp4" />
      </video>
      <div className="landing-hero-overlay" aria-hidden />
    </>
  )
}
