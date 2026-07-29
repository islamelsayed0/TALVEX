import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { getInventoryItem } from '@/lib/db/inventory'

import { ghostButton } from '../../../monitors/ui'
import { updateInventoryItemAction } from '../../actions'
import { InventoryForm, StockChip, inventoryFormDefaults } from '../../ui'

export const metadata = { title: 'Edit inventory item — Talvex' }

/**
 * Edit an item or head to deletion. The stock chip up top reflects the
 * stored row; saving a quantity change lands back on the list where the
 * fresh derivation shows.
 */
export default async function EditInventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const { id } = await params
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  const item = await getInventoryItem(id)
  if (!item) notFound()

  const hasRoundTrip = asString(sp.error) !== ''
  const defaults = hasRoundTrip
    ? {
        name: asString(sp.name),
        itemNumber: asString(sp.item_number),
        serialNumber: asString(sp.serial_number),
        location: asString(sp.location),
        quantity: asString(sp.quantity),
        minStock: asString(sp.min_stock),
        buyUrl: asString(sp.buy_url),
        notes: asString(sp.notes),
      }
    : inventoryFormDefaults(item)

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-[640px] flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">Edit item</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{item.name}</p>
        </div>
        <StockChip item={item} />
      </div>

      <InventoryForm
        action={updateInventoryItemAction}
        submitLabel="Save changes"
        cancelHref="/dashboard/inventory"
        error={asString(sp.error) || undefined}
        defaults={defaults}
        itemId={item.id}
      />

      <div className="flex w-full max-w-[640px] items-center justify-between gap-3 rounded-button border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          No longer tracking this item?
        </p>
        <Link
          href={`/dashboard/inventory/${item.id}/delete`}
          className={ghostButton}
        >
          Delete
        </Link>
      </div>
    </main>
  )
}
