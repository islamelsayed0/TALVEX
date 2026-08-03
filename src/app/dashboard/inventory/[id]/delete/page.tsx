import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { getInventoryItem } from '@/lib/db/inventory'

import { ghostButton, primaryButton } from '../../../monitors/ui'
import { deleteInventoryItemAction } from '../../actions'

export const metadata = { title: 'Delete inventory item — Talvext' }

/**
 * The plain confirmation for deletion, the monitors idiom: its own page,
 * fully server side. The delete button uses the primary accent, not red;
 * red is reserved for status meaning, never chrome. The deletion itself is
 * audited by the database trigger.
 */
export default async function DeleteInventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()

  const { id } = await params
  const item = await getInventoryItem(id)
  if (!item) notFound()

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-md flex-col gap-4 rounded-button border border-border bg-card p-6">
        <h1 className="text-title text-card-foreground">Delete {item.name}?</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This removes the item from your inventory. There is no undo, and the
          deletion is recorded in the audit log.
        </p>
        <form action={deleteInventoryItemAction} className="flex items-center gap-3">
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" className={primaryButton}>
            Delete item
          </button>
          <Link href={`/dashboard/inventory/${item.id}/edit`} className={ghostButton}>
            Cancel
          </Link>
        </form>
      </div>
    </main>
  )
}
