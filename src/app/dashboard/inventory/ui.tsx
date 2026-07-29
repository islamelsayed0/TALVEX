import type { InventoryItem } from '@/lib/db/types'
import { isLowStock } from '@/lib/db/inventory'

import { ghostButton, primaryButton } from '../monitors/ui'
import { FormError, ticketFieldClass } from '../tickets/ui'

/**
 * Shared server rendered pieces for the inventory screens. No client
 * components; every form posts to a server action, and validation failures
 * round trip through query params (the monitors form idiom).
 *
 * Color rule: the stock chip uses the reserved status tokens and only them.
 * Low stock is the alarm this feature exists to surface, so it wears the
 * down red; healthy stock wears the up green. No new colors exist.
 */

export function StockChip({
  item,
}: {
  item: Pick<InventoryItem, 'quantity' | 'min_stock'>
}) {
  const low = isLowStock(item)
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-medium ${
        low ? 'text-status-down' : 'text-status-up'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${low ? 'bg-status-down' : 'bg-status-up'}`}
        aria-hidden
      />
      {low ? 'Low stock' : 'In stock'}
    </span>
  )
}

export type InventoryFormDefaults = {
  name: string
  itemNumber: string
  serialNumber: string
  location: string
  quantity: string
  minStock: string
  buyUrl: string
  notes: string
}

export function inventoryFormDefaults(item: InventoryItem): InventoryFormDefaults {
  return {
    name: item.name,
    itemNumber: item.item_number ?? '',
    serialNumber: item.serial_number ?? '',
    location: item.location ?? '',
    quantity: String(item.quantity),
    minStock: String(item.min_stock),
    buyUrl: item.buy_url ?? '',
    notes: item.notes ?? '',
  }
}

/**
 * The add and edit form. `error` and the defaults come from query params on
 * a failed submit, so the entered values survive the round trip.
 */
export function InventoryForm({
  action,
  submitLabel,
  cancelHref,
  defaults,
  error,
  itemId,
}: {
  action: (formData: FormData) => Promise<void>
  submitLabel: string
  cancelHref: string
  defaults: InventoryFormDefaults
  error?: string
  itemId?: string
}) {
  return (
    <form
      action={action}
      className="flex w-full max-w-[640px] flex-col gap-4 rounded-button border border-border bg-card p-6"
    >
      {itemId ? <input type="hidden" name="id" value={itemId} /> : null}
      <FormError message={error} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-muted-foreground">Name</span>
        <input
          name="name"
          defaultValue={defaults.name}
          required
          maxLength={120}
          className={ticketFieldClass}
          placeholder="Toner cartridge, HP 26A"
        />
      </label>

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">Item number</span>
          <input
            name="item_number"
            defaultValue={defaults.itemNumber}
            maxLength={60}
            className={ticketFieldClass}
            placeholder="PRN-004"
          />
          <span className="text-[11.5px] text-quiet">
            Your own label. Unique in your organization; leave empty if unnumbered.
          </span>
        </label>

        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">Serial number</span>
          <input
            name="serial_number"
            defaultValue={defaults.serialNumber}
            maxLength={120}
            className={ticketFieldClass}
            placeholder="CN12345678"
          />
          <span className="text-[11.5px] text-quiet">
            The vendor serial, if it has one.
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">Location</span>
          <input
            name="location"
            defaultValue={defaults.location}
            maxLength={120}
            className={ticketFieldClass}
            placeholder="Storage room B, shelf 2"
          />
        </label>

        <label className="flex w-full flex-col gap-1.5 sm:w-[120px]">
          <span className="text-[12.5px] text-muted-foreground">Quantity</span>
          <input
            name="quantity"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={defaults.quantity}
            className={ticketFieldClass}
          />
        </label>

        <label className="flex w-full flex-col gap-1.5 sm:w-[120px]">
          <span className="text-[12.5px] text-muted-foreground">Minimum stock</span>
          <input
            name="min_stock"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={defaults.minStock}
            className={ticketFieldClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-muted-foreground">Buy link</span>
        <input
          name="buy_url"
          type="url"
          defaultValue={defaults.buyUrl}
          className={ticketFieldClass}
          placeholder="https://store.example.com/toner-26a"
        />
        <span className="text-[11.5px] text-quiet">
          Where to reorder. http or https, optional.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-muted-foreground">Notes</span>
        <textarea
          name="notes"
          defaultValue={defaults.notes}
          rows={4}
          maxLength={2000}
          className={`${ticketFieldClass} h-auto min-h-[96px] resize-y py-3 leading-relaxed`}
          placeholder="Fits the two Laserjets on the third floor."
        />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton}>
          {submitLabel}
        </button>
        <a href={cancelHref} className={ghostButton}>
          Cancel
        </a>
      </div>
    </form>
  )
}
