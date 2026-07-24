import type { ChatRole } from '@/lib/db/types'

/**
 * Shared bubble styling for chat, importable by both the server rendered
 * transcript and the client pane (no directive, so neither boundary is
 * violated). Chat uses NO status colors: green, amber, and red stay reserved
 * for monitor and incident state. Bubbles are told apart by side and surface,
 * not by color. Blue accent stays exclusive to primary actions.
 */

export const bubbleRow: Record<ChatRole, string> = {
  user: 'flex justify-end',
  assistant: 'flex justify-start',
}

export const bubble: Record<ChatRole, string> = {
  // The member's own words, right aligned on the neutral field surface.
  user: 'max-w-[85%] rounded-button border border-input bg-field px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-field-text',
  // The assistant, left aligned on the card surface.
  assistant:
    'max-w-[85%] rounded-button border border-border bg-card px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground',
}

export const roleLabel: Record<ChatRole, string> = {
  user: 'You',
  assistant: 'Assistant',
}
