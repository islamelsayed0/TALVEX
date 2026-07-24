import { getActiveOrgViewer, type OrgViewer } from '@/lib/auth/org-viewer'
import { createOrgScopedClient } from './client'
import type {
  ChatConversation,
  ChatConversationStatus,
  ChatMessage,
} from './types'

/**
 * Typed data layer for chat (CLAUDE.md code rule 7), the parts that run under
 * the caller's own RLS: reading conversations and messages, creating a
 * conversation, and updating its status. Message rows are written only by the
 * server (the chat engine, on the service role), so there is no message insert
 * here; migration 008 explains why.
 *
 * Visibility is the database's to enforce (addendum ruling): a member sees only
 * their own conversations, an org admin sees all of them, and messages ride
 * that. This layer just asks.
 */

const TITLE_MAX = 200

export async function getChatViewer(): Promise<OrgViewer> {
  return getActiveOrgViewer()
}

/** A short title from the first user message: one line, trimmed, capped. */
export function titleFromMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim()
  if (oneLine === '') return 'New conversation'
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine
}

/**
 * The conversations this session may see, most recently active first. For a
 * member that is their own; for an admin, the whole org (addendum ruling).
 */
export async function listConversations(): Promise<ChatConversation[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('chat_conversations')
    .select()
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

/** One conversation by id, or null when this session cannot see it. */
export async function getConversation(
  id: string,
): Promise<ChatConversation | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('chat_conversations')
    .select()
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** The messages of one conversation, chronological. RLS scopes visibility. */
export async function listMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('chat_messages')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * Mark a conversation resolved (the user confirmed it is solved) or escalated
 * (a ticket was created from it). RLS lets only the creator do this, and the
 * column grant limits the write to status; for anyone else the update matches
 * zero rows and null comes back.
 */
export async function setConversationStatus(
  id: string,
  status: ChatConversationStatus,
): Promise<ChatConversation | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('chat_conversations')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

export { TITLE_MAX }
