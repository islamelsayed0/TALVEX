'use client'

import { useEffect, useRef } from 'react'

/**
 * The fixed background video behind the landing page, plus the vignette that
 * keeps text legible over it. Client only because autoplay needs a nudge and
 * the video must be kept muted defensively.
 *
 * Muting is guaranteed three ways: the `muted` attribute, a reassert on mount,
 * and (because a stray script or extension could flip it) the volume is pinned
 * to 0. There is no audio track we ever want to hear here.
 */
export function HeroBackground() {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true
    v.volume = 0

    const markReady = () => v.setAttribute('data-ready', 'true')
    if (v.readyState >= 3) markReady()
    else v.addEventListener('canplay', markReady, { once: true })

    // Browsers may defer autoplay until the element is ready; nudge it and
    // ignore the promise rejection that a blocked autoplay throws.
    v.play().catch(() => {})

    return () => v.removeEventListener('canplay', markReady)
  }, [])

  return (
    <>
      <video
        ref={ref}
        className="landing-hero-video"
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
