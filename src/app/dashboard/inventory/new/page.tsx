import { requireAdmin } from '@/lib/auth/org-viewer'

import { createInventoryItemAction } from '../actions'
import { InventoryForm } from '../ui'

export const metadata = { title: 'Add inventory item — Talvex' }

/**
 * Add an item. On a failed submit the server action redirects back here
 * with the message and the entered values in the query string, so the form
 * renders again filled in without any client code.
 */
export default async function NewInventoryItemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-title text-foreground">Add item</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Anything physical your team looks after: machines, spares, consumables.
        </p>
      </div>
      <InventoryForm
        action={createInventoryItemAction}
        submitLabel="Add item"
        cancelHref="/dashboard/inventory"
        error={asString(sp.error) || undefined}
        defaults={{
          name: asString(sp.name),
          itemNumber: asString(sp.item_number),
          serialNumber: asString(sp.serial_number),
          location: asString(sp.location),
          quantity: asString(sp.quantity) || '0',
          minStock: asString(sp.min_stock) || '0',
          buyUrl: asString(sp.buy_url),
          notes: asString(sp.notes),
        }}
      />
    </main>
  )
}
