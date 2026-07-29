'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  createInventoryItem,
  deleteInventoryItem,
  InventoryValidationError,
  updateInventoryItem,
  type InventoryItemInput,
} from '@/lib/db/inventory'
import { OrgNotSyncedError } from '@/lib/db/monitors'

/**
 * Server actions for the inventory screens, the monitors pattern: parse the
 * form, call the data layer, land somewhere honest. Validation failures
 * round trip through query params so the form renders again server side
 * with the message and the entered values.
 *
 * Authorization lives in RLS, not here: a member posting one of these by
 * hand is refused by the database (42501). These actions never check roles
 * themselves.
 *
 * redirect() works by throwing, so it is only ever called OUTSIDE the try
 * blocks that catch data layer errors.
 */

function parseForm(formData: FormData): InventoryItemInput {
  return {
    name: String(formData.get('name') ?? ''),
    itemNumber: String(formData.get('item_number') ?? ''),
    serialNumber: String(formData.get('serial_number') ?? ''),
    location: String(formData.get('location') ?? ''),
    quantity: Number(formData.get('quantity') ?? Number.NaN),
    minStock: Number(formData.get('min_stock') ?? Number.NaN),
    buyUrl: String(formData.get('buy_url') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  }
}

/** Query string that refills the form and shows the error. */
function formQuery(input: InventoryItemInput, message: string): string {
  return new URLSearchParams({
    error: message,
    name: input.name,
    item_number: input.itemNumber,
    serial_number: input.serialNumber,
    location: input.location,
    quantity: Number.isNaN(input.quantity) ? '' : String(input.quantity),
    min_stock: Number.isNaN(input.minStock) ? '' : String(input.minStock),
    buy_url: input.buyUrl,
    notes: input.notes,
  }).toString()
}

function friendlyMessage(err: unknown): string | null {
  if (err instanceof InventoryValidationError || err instanceof OrgNotSyncedError) {
    return err.message
  }
  return null
}

export async function createInventoryItemAction(formData: FormData): Promise<void> {
  const input = parseForm(formData)

  let failure: string | null = null
  try {
    await createInventoryItem(input)
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    redirect(`/dashboard/inventory/new?${formQuery(input, failure)}`)
  }

  revalidatePath('/dashboard/inventory')
  redirect('/dashboard/inventory')
}

export async function updateInventoryItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const input = parseForm(formData)

  let failure: string | null = null
  let found = true
  try {
    found = (await updateInventoryItem(id, input)) !== null
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    redirect(`/dashboard/inventory/${id}/edit?${formQuery(input, failure)}`)
  }
  // Vanished under our feet (deleted elsewhere, or never this org's row;
  // RLS makes those look identical). The list is the honest place to land.
  if (!found) {
    redirect('/dashboard/inventory')
  }

  revalidatePath('/dashboard/inventory')
  redirect('/dashboard/inventory')
}

export async function deleteInventoryItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await deleteInventoryItem(id)

  revalidatePath('/dashboard/inventory')
  redirect('/dashboard/inventory')
}
