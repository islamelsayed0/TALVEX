import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { isLowStock, listInventoryItems } from '@/lib/db/inventory'

import { Card } from '../_overview/ui'
import { ghostButton, primaryButton } from '../monitors/ui'
import { ticketFieldClass } from '../tickets/ui'
import { StockChip } from './ui'

export const metadata = { title: 'Inventory — Talvex' }

const ROW = 'grid grid-cols-[minmax(0,1fr)_130px_minmax(0,190px)_120px_120px] gap-3.5'

/**
 * The inventory list (F15). Admin only end to end: requireAdmin redirects a
 * member, the nav never offers them the route, and RLS refuses their
 * queries loudly regardless. Rows arrive low stock first then by name from
 * the data layer, so what needs reordering is always at the top.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''
  const q = asString(sp.q)
  const lowOnly = asString(sp.low) === '1'

  // Two reads, the articles construction: the narrowed rows to show, and
  // the unfiltered set for the header counts so they never lose meaning
  // while a filter is active.
  const [items, all] = await Promise.all([
    listInventoryItems({ q: q || undefined, lowOnly }),
    listInventoryItems(),
  ])
  const lowCount = all.filter(isLowStock).length

  const filterHref = (low: boolean) => {
    const params = new URLSearchParams()
    if (low) params.set('low', '1')
    if (q) params.set('q', q)
    const s = params.toString()
    return s ? `/dashboard/inventory?${s}` : '/dashboard/inventory'
  }

  return (
    <main className="mx-auto w-full max-w-[1360px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-title text-foreground">Inventory</h1>
          <p className="mt-1.5 text-[14px] text-quiet">
            {all.length} {all.length === 1 ? 'item' : 'items'} · {lowCount} low on
            stock
          </p>
        </div>
        <Link href="/dashboard/inventory/new" className={primaryButton}>
          Add item
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav
          className="flex flex-wrap items-center gap-1.5 text-sm"
          aria-label="Filter by stock"
        >
          <Link
            href={filterHref(false)}
            aria-current={!lowOnly ? 'page' : undefined}
            className="nav-item rounded-nav px-3 py-1.5 text-[13px] font-medium transition-colors"
          >
            All
          </Link>
          <Link
            href={filterHref(true)}
            aria-current={lowOnly ? 'page' : undefined}
            className="nav-item rounded-nav px-3 py-1.5 text-[13px] font-medium transition-colors"
          >
            Low stock
          </Link>
        </nav>
        <form action="/dashboard/inventory" className="flex items-center gap-2">
          {lowOnly ? <input type="hidden" name="low" value="1" /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name or item number"
            className={`${ticketFieldClass} h-10 w-[240px]`}
          />
          <button type="submit" className={`${ghostButton} h-10 px-3.5 py-0`}>
            Search
          </button>
        </form>
      </div>

      {items.length === 0 ? (
        <Card className="p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            {all.length === 0 ? 'No items yet' : 'Nothing matches'}
          </h2>
          <p className="mt-3 max-w-[460px] text-sm leading-relaxed text-muted-foreground">
            {all.length === 0
              ? 'Track the physical things your team looks after here: machines, printers, spare parts, cables, toner. Each item carries a quantity and a minimum stock, and Talvex flags anything running low.'
              : 'No items match this filter. Clear it or try another search.'}
          </p>
          {all.length === 0 ? (
            <Link href="/dashboard/inventory/new" className={`${primaryButton} mt-4`}>
              Add the first item
            </Link>
          ) : null}
        </Card>
      ) : (
        <Card className="pb-2">
          <div className={`${ROW} px-[22px] py-3.5 text-column text-quiet uppercase`}>
            <span>Item</span>
            <span>Item number</span>
            <span>Location</span>
            <span className="text-right">Stock · minimum</span>
            <span>Status</span>
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              className={`${ROW} items-center border-t border-divider px-[22px] py-3.5`}
            >
              <div className="min-w-0">
                <Link
                  href={`/dashboard/inventory/${item.id}/edit`}
                  className="block truncate text-sm font-medium text-foreground hover:text-accent-text"
                >
                  {item.name}
                </Link>
                {item.serial_number ? (
                  <div className="mt-0.5 truncate font-mono text-[12px] text-quiet">
                    {item.serial_number}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 truncate font-mono text-[13px] text-muted-foreground">
                {item.item_number ?? '—'}
              </div>
              <div className="min-w-0 truncate text-[13px] text-muted-foreground">
                {item.location ?? '—'}
              </div>
              <div className="text-right font-mono text-[13px] text-muted-foreground">
                {item.quantity} · {item.min_stock}
              </div>
              <div>
                <StockChip item={item} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </main>
  )
}
