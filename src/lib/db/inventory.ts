import { createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'
import type { InventoryItem } from './types'

/**
 * Typed data layer for inventory (F15, CLAUDE.md code rule 7). Everything
 * runs on the org scoped client, so RLS has already applied the admin only
 * rule before any code here sees a row: a member reaches nothing on this
 * table, and the database refuses them loudly (42501) rather than returning
 * an empty list that could read as an empty inventory. Nothing in this file
 * re-implements that rule; the database is the authority and this layer
 * just asks.
 *
 * Low stock is DERIVED here, never stored (ruling 2): an item is low when
 * its quantity is at or below its minimum stock. Postgres cannot compare
 * two columns through PostgREST filters, so the low stock narrowing and the
 * list order are computed in the pure helpers below, which the unit tests
 * pin.
 */

/** User input failed validation; message is safe to show as form feedback. */
export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryValidationError'
  }
}

const NAME_MAX = 120
const ITEM_NUMBER_MAX = 60
const SERIAL_MAX = 120
const LOCATION_MAX = 120
const URL_MAX = 2048
const NOTES_MAX = 2000

export type InventoryItemInput = {
  name: string
  itemNumber: string
  serialNumber: string
  location: string
  quantity: number
  minStock: number
  buyUrl: string
  notes: string
}

type ValidatedItem = {
  name: string
  item_number: string | null
  serial_number: string | null
  location: string | null
  quantity: number
  min_stock: number
  buy_url: string | null
  notes: string | null
}

/**
 * Buy link validation, the notifications normalizer idiom: a pure function
 * that returns the normalized href or null for input it refuses. Empty
 * input is not an error; it means no link, and callers pass that through
 * as NULL. Only http and https survive, a host must be present, and
 * embedded credentials are refused outright (they would sit in plain text
 * on an inventory row).
 */
export function normalizeBuyUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > URL_MAX) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  if (url.username !== '' || url.password !== '') return null
  return url.href
}

/** The server side validation (ruling 4 and 5), exported pure so the unit
 * tests pin the bounds. Returns the row shape the database takes. */
export function validateInventoryInput(input: InventoryItemInput): ValidatedItem {
  const name = input.name.trim()
  const itemNumber = input.itemNumber.trim()
  const serialNumber = input.serialNumber.trim()
  const location = input.location.trim()
  const buyUrl = input.buyUrl.trim()
  const notes = input.notes.trim()

  if (name === '') {
    throw new InventoryValidationError('Give the item a name.')
  }
  if (name.length > NAME_MAX) {
    throw new InventoryValidationError('Keep the name under 120 characters.')
  }
  if (itemNumber.length > ITEM_NUMBER_MAX) {
    throw new InventoryValidationError('Keep the item number under 60 characters.')
  }
  if (serialNumber.length > SERIAL_MAX) {
    throw new InventoryValidationError('Keep the serial number under 120 characters.')
  }
  if (location.length > LOCATION_MAX) {
    throw new InventoryValidationError('Keep the location under 120 characters.')
  }
  if (notes.length > NOTES_MAX) {
    throw new InventoryValidationError('Keep the notes under 2,000 characters.')
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new InventoryValidationError('Quantity must be a whole number, zero or more.')
  }
  if (!Number.isInteger(input.minStock) || input.minStock < 0) {
    throw new InventoryValidationError('Minimum stock must be a whole number, zero or more.')
  }

  let buy_url: string | null = null
  if (buyUrl !== '') {
    buy_url = normalizeBuyUrl(buyUrl)
    if (buy_url === null) {
      throw new InventoryValidationError(
        'That buy link does not look right. Paste a full http or https address.',
      )
    }
  }

  return {
    name,
    item_number: itemNumber === '' ? null : itemNumber,
    serial_number: serialNumber === '' ? null : serialNumber,
    location: location === '' ? null : location,
    quantity: input.quantity,
    min_stock: input.minStock,
    buy_url,
    notes: notes === '' ? null : notes,
  }
}

// ---------------------------------------------------------------------------
// Pure helpers for the screens, unit tested.

/** The derived low stock signal (ruling 2): at or below minimum stock. */
export function isLowStock(
  item: Pick<InventoryItem, 'quantity' | 'min_stock'>,
): boolean {
  return item.quantity <= item.min_stock
}

/** List order: low stock first (the items needing attention), then name. */
export function sortInventory(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => {
    const lowA = isLowStock(a) ? 0 : 1
    const lowB = isLowStock(b) ? 0 : 1
    if (lowA !== lowB) return lowA - lowB
    return a.name.localeCompare(b.name)
  })
}

/** The low stock only narrowing, in code because PostgREST cannot compare
 * two columns. */
export function filterLowStock(
  items: InventoryItem[],
  lowOnly: boolean,
): InventoryItem[] {
  return lowOnly ? items.filter(isLowStock) : items
}

/** % and _ are LIKE wildcards; a searcher typing them means the characters. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

// ---------------------------------------------------------------------------
// Queries. RLS does the admin and org work; these just narrow and order.

export type InventoryFilter = {
  /** Matches against name and item number. */
  q?: string
  /** Only items at or below their minimum stock. */
  lowOnly?: boolean
}

/**
 * The org's inventory for this admin session, low stock first then by name.
 * Search matches name and item number at the database; the low stock
 * narrowing happens here because it is derived.
 */
export async function listInventoryItems(
  filter: InventoryFilter = {},
): Promise<InventoryItem[]> {
  const { client } = await createOrgScopedClient()
  let query = client.from('inventory_items').select()
  const q = filter.q?.trim()
  if (q) {
    const pattern = `%${escapeLike(q)}%`
    query = query.or(`name.ilike.${pattern},item_number.ilike.${pattern}`)
  }
  const { data, error } = await query
  if (error) throw error
  return sortInventory(filterLowStock(data, filter.lowOnly === true))
}

/** One item by id, or null when this session cannot see it. */
export async function getInventoryItem(id: string): Promise<InventoryItem | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('inventory_items')
    .select()
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** The duplicate item number refusal, translated for the form. */
function friendlyDbError(error: { code?: string; message: string }): Error {
  if (
    error.code === '23505' ||
    error.message.includes('inventory_items_org_id_item_number_key')
  ) {
    return new InventoryValidationError(
      'That item number is already in use. Item numbers are unique within your organization.',
    )
  }
  return Object.assign(new Error(error.message), error)
}

/**
 * Create an item as the signed in admin. RLS refuses anyone else loudly.
 * The audit row is written by the database trigger, not here.
 */
export async function createInventoryItem(
  input: InventoryItemInput,
): Promise<InventoryItem> {
  const row = validateInventoryInput(input)
  const { client, orgId } = await createOrgScopedClient()

  const { data: org, error: orgError } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (orgError) throw orgError
  if (!org) throw new OrgNotSyncedError()

  const { data, error } = await client
    .from('inventory_items')
    .insert({ ...row, org_id: org.id })
    .select()
    .single()
  if (error) throw friendlyDbError(error)
  return data
}

/**
 * Edit an item's fields. RLS makes this admin only and org scoped: an id
 * from another org matches zero rows and null comes back, indistinguishable
 * from an item that does not exist. The audit trigger records which fields
 * changed; notes content never reaches the log.
 */
export async function updateInventoryItem(
  id: string,
  input: InventoryItemInput,
): Promise<InventoryItem | null> {
  const row = validateInventoryInput(input)
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('inventory_items')
    .update(row)
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw friendlyDbError(error)
  return data
}

/** Delete an item. Admin only via RLS; the audit trigger records the
 * deletion with the item's name. */
export async function deleteInventoryItem(id: string): Promise<void> {
  const { client } = await createOrgScopedClient()
  const { error } = await client.from('inventory_items').delete().eq('id', id)
  if (error) throw error
}
