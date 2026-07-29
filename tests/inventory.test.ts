import { describe, expect, it } from 'vitest'

import {
  filterLowStock,
  InventoryValidationError,
  isLowStock,
  normalizeBuyUrl,
  sortInventory,
  validateInventoryInput,
  type InventoryItemInput,
} from '@/lib/db/inventory'
import type { InventoryItem } from '@/lib/db/types'

// Pure helpers for the inventory feature (F15). The database is the
// authority on access and on the value bounds (checks in migration 016);
// what lives here is the derived logic the screens read: the low stock
// rule, the buy link normalizer, and the list order.

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'itm_1',
    org_id: 'org_1',
    name: 'Toner',
    item_number: null,
    serial_number: null,
    location: null,
    quantity: 0,
    min_stock: 0,
    buy_url: null,
    notes: null,
    created_at: '2026-07-29T00:00:00Z',
    updated_at: '2026-07-29T00:00:00Z',
    ...overrides,
  }
}

function input(overrides: Partial<InventoryItemInput>): InventoryItemInput {
  return {
    name: 'Toner cartridge',
    itemNumber: '',
    serialNumber: '',
    location: '',
    quantity: 0,
    minStock: 0,
    buyUrl: '',
    notes: '',
    ...overrides,
  }
}

describe('validateInventoryInput: the server side bounds (rulings 4 and 5)', () => {
  it('accepts a minimal item and nulls the empty optionals', () => {
    expect(validateInventoryInput(input({}))).toEqual({
      name: 'Toner cartridge',
      item_number: null,
      serial_number: null,
      location: null,
      quantity: 0,
      min_stock: 0,
      buy_url: null,
      notes: null,
    })
  })

  it('trims and passes through the optionals when present', () => {
    const row = validateInventoryInput(
      input({
        itemNumber: ' PRN-004 ',
        serialNumber: ' CN123 ',
        location: ' Shelf 2 ',
        quantity: 7,
        minStock: 2,
        buyUrl: ' https://example.com/x ',
        notes: ' fits the third floor printers ',
      }),
    )
    expect(row).toMatchObject({
      item_number: 'PRN-004',
      serial_number: 'CN123',
      location: 'Shelf 2',
      quantity: 7,
      min_stock: 2,
      buy_url: 'https://example.com/x',
      notes: 'fits the third floor printers',
    })
  })

  it('refuses an empty or overlong name', () => {
    expect(() => validateInventoryInput(input({ name: '  ' }))).toThrow(
      InventoryValidationError,
    )
    expect(() =>
      validateInventoryInput(input({ name: 'x'.repeat(121) })),
    ).toThrow(InventoryValidationError)
    expect(validateInventoryInput(input({ name: 'x'.repeat(120) })).name).toHaveLength(120)
  })

  it('refuses overlong item number, serial, location, and notes', () => {
    expect(() =>
      validateInventoryInput(input({ itemNumber: 'x'.repeat(61) })),
    ).toThrow(InventoryValidationError)
    expect(() =>
      validateInventoryInput(input({ serialNumber: 'x'.repeat(121) })),
    ).toThrow(InventoryValidationError)
    expect(() =>
      validateInventoryInput(input({ location: 'x'.repeat(121) })),
    ).toThrow(InventoryValidationError)
    expect(() =>
      validateInventoryInput(input({ notes: 'x'.repeat(2001) })),
    ).toThrow(InventoryValidationError)
  })

  it('refuses non integer or negative quantities and minimums', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateInventoryInput(input({ quantity: bad }))).toThrow(
        InventoryValidationError,
      )
      expect(() => validateInventoryInput(input({ minStock: bad }))).toThrow(
        InventoryValidationError,
      )
    }
    expect(validateInventoryInput(input({ quantity: 0, minStock: 0 }))).toBeTruthy()
  })

  it('refuses a bad buy link as a form error, not a silent drop', () => {
    expect(() =>
      validateInventoryInput(input({ buyUrl: 'ftp://example.com/x' })),
    ).toThrow(InventoryValidationError)
  })
})

describe('isLowStock: quantity at or below minimum stock, never stored', () => {
  it('is low exactly at the minimum', () => {
    expect(isLowStock(item({ quantity: 3, min_stock: 3 }))).toBe(true)
  })

  it('is low below the minimum', () => {
    expect(isLowStock(item({ quantity: 1, min_stock: 3 }))).toBe(true)
  })

  it('is not low above the minimum', () => {
    expect(isLowStock(item({ quantity: 4, min_stock: 3 }))).toBe(false)
  })

  it('a zero minimum flags only a zero quantity', () => {
    // quantity <= min_stock with min_stock 0: empty is low, anything on the
    // shelf is not.
    expect(isLowStock(item({ quantity: 0, min_stock: 0 }))).toBe(true)
    expect(isLowStock(item({ quantity: 1, min_stock: 0 }))).toBe(false)
  })
})

describe('normalizeBuyUrl: the notifications normalizer idiom', () => {
  it('accepts http and https and returns the normalized href', () => {
    expect(normalizeBuyUrl('https://store.example.com/toner')).toBe(
      'https://store.example.com/toner',
    )
    expect(normalizeBuyUrl('http://example.com')).toBe('http://example.com/')
    expect(normalizeBuyUrl('  https://example.com/x  ')).toBe('https://example.com/x')
  })

  it('refuses everything that is not an http or https URL', () => {
    for (const bad of [
      'ftp://example.com/file',
      'javascript:alert(1)',
      'not a url',
      'example.com/no-scheme',
      'https://',
    ]) {
      expect(normalizeBuyUrl(bad)).toBeNull()
    }
  })

  it('refuses embedded credentials', () => {
    expect(normalizeBuyUrl('https://user:pass@example.com/')).toBeNull()
  })

  it('treats empty input as no link, and refuses the absurdly long', () => {
    expect(normalizeBuyUrl('')).toBeNull()
    expect(normalizeBuyUrl('   ')).toBeNull()
    expect(normalizeBuyUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull()
  })
})

describe('sortInventory: low stock first, then name', () => {
  it('puts every low item ahead of every stocked one', () => {
    const sorted = sortInventory([
      item({ name: 'Cables', quantity: 40, min_stock: 5 }),
      item({ name: 'Toner', quantity: 1, min_stock: 3 }),
      item({ name: 'Mice', quantity: 9, min_stock: 2 }),
      item({ name: 'Batteries', quantity: 2, min_stock: 2 }),
    ])
    expect(sorted.map((i) => i.name)).toEqual([
      'Batteries',
      'Toner',
      'Cables',
      'Mice',
    ])
  })

  it('orders alphabetically inside each band and leaves the input untouched', () => {
    const input = [
      item({ name: 'Zip ties', quantity: 10, min_stock: 1 }),
      item({ name: 'Adapters', quantity: 10, min_stock: 1 }),
    ]
    const sorted = sortInventory(input)
    expect(sorted.map((i) => i.name)).toEqual(['Adapters', 'Zip ties'])
    expect(input.map((i) => i.name)).toEqual(['Zip ties', 'Adapters'])
  })
})

describe('filterLowStock', () => {
  const items = [
    item({ name: 'Low', quantity: 0, min_stock: 1 }),
    item({ name: 'Fine', quantity: 5, min_stock: 1 }),
  ]

  it('narrows to low items when asked', () => {
    expect(filterLowStock(items, true).map((i) => i.name)).toEqual(['Low'])
  })

  it('passes everything through when not', () => {
    expect(filterLowStock(items, false)).toEqual(items)
  })
})
