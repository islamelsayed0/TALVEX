"use client";

/**
 * The circular theme toggle from the design reference: moon in dark mode,
 * sun in light mode. Which icon shows is decided by CSS keyed off the
 * data-theme attribute (the .when-dark / .when-light rules in globals.css),
 * so this component needs no state and cannot mismatch during hydration.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("talvex-theme", next);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works
      // for the current page view.
    }
  }

  return (
    <button
      type="button"
      aria-label="Toggle color theme"
      onClick={toggle}
      className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-(--toggle-border) bg-(--toggle-bg) text-link transition-colors duration-150 hover:bg-(--ghost-hover-bg) ${className}`}
    >
      {/* Moon, shown while dark. */}
      <svg
        className="when-dark"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {/* Sun, shown while light. */}
      <svg
        className="when-light"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
