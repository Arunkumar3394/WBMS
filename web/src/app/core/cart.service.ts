import { Injectable, computed, effect, signal } from '@angular/core';
import { Product } from './models';

export interface CartLine {
  product_id: number;
  slug: string;
  name: string;
  unit_label: string;
  /** Price when added; the server works out the real total at checkout. */
  price: number;
  is_sample_price: boolean;
  quantity: number;
  min_order_qty: number;
  max_order_qty: number;
  image_url: string | null;
  category_slug: string;
}

const STORAGE_KEY = 'aquapure.cart.v1';

/**
 * The shopping cart, kept in this browser only. It never decides prices:
 * the API recalculates every amount from the database when the order is placed.
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  readonly lines = signal<CartLine[]>(load());
  readonly count = computed(() => this.lines().reduce((n, l) => n + l.quantity, 0));
  readonly subtotal = computed(() => this.lines().reduce((s, l) => s + l.price * l.quantity, 0));

  constructor() {
    effect(() => save(this.lines()));
  }

  add(p: Product, quantity: number): void {
    this.lines.update((lines) => {
      const existing = lines.find((l) => l.product_id === p.id);
      if (existing) {
        return lines.map((l) => (l.product_id === p.id ? { ...l, ...snapshot(p), quantity: clamp(l.quantity + quantity, l) } : l));
      }
      const line: CartLine = { ...snapshot(p), quantity: 0 };
      return [...lines, { ...line, quantity: clamp(quantity, line) }];
    });
  }

  setQuantity(productId: number, quantity: number): void {
    this.lines.update((lines) => lines.map((l) => (l.product_id === productId ? { ...l, quantity: clamp(quantity, l) } : l)));
  }

  remove(productId: number): void {
    this.lines.update((lines) => lines.filter((l) => l.product_id !== productId));
  }

  clear(): void {
    this.lines.set([]);
  }

  /** Refreshes names and prices from the latest catalog; drops products that are no longer sold. */
  sync(products: Product[]): void {
    const byId = new Map(products.map((p) => [p.id, p]));
    this.lines.update((lines) =>
      lines
        .filter((l) => byId.has(l.product_id) && byId.get(l.product_id)!.in_stock)
        .map((l) => {
          const fresh = { ...l, ...snapshot(byId.get(l.product_id)!) };
          return { ...fresh, quantity: clamp(l.quantity, fresh) };
        }),
    );
  }
}

function snapshot(p: Product): Omit<CartLine, 'quantity'> {
  return {
    product_id: p.id, slug: p.slug, name: p.name, unit_label: p.unit_label, price: Number(p.price),
    is_sample_price: p.is_sample_price, min_order_qty: p.min_order_qty, max_order_qty: p.max_order_qty,
    image_url: p.image_url, category_slug: p.category_slug,
  };
}

function clamp(q: number, l: Pick<CartLine, 'min_order_qty' | 'max_order_qty'>): number {
  const n = Math.floor(Number(q) || 0);
  return Math.min(Math.max(n, l.min_order_qty), l.max_order_qty);
}

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => typeof l?.product_id === 'number' && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

function save(lines: CartLine[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Private browsing or storage full: the cart still works for this visit.
  }
}
