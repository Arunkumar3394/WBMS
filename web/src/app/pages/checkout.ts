import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { CartService } from '../core/cart.service';
import { Address, PaymentMethod, Profile, PublicSettings, Quote, Slot } from '../core/models';
import { PaymentService } from '../core/payment.service';
import { AddressForm } from '../shared/address-form';
import { addDays, formatDay } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, PageHeader, Spinner } from '../shared/ui';

/**
 * Checkout: address, delivery date and slot, payment method. The browser sends only product ids and
 * quantities; the server prices the order (app.quote_order / app.place_order).
 */
@Component({
  selector: 'app-checkout',
  imports: [FormsModule, RouterLink, AddressForm, RupeesPipe, PageHeader, Spinner, ErrorBox],
  template: `
    <app-page-header title="Checkout" />
    <div class="container-page py-10">
      @if (cart.lines().length === 0 && !placing()) {
        <div class="card p-10 text-center">
          <p class="text-lg text-slate-700">Your cart is empty.</p>
          <div class="mt-6 flex justify-center gap-3">
            <a routerLink="/products" class="btn-primary">Browse products</a>
            <a routerLink="/orders" class="btn-secondary">My orders</a>
          </div>
        </div>
      } @else if (loading()) {
        <app-spinner label="Loading checkout…" />
      } @else if (loadError()) {
        <app-error [message]="loadError()!" [retry]="load" />
      } @else if (!canOrder()) {
        <div class="card p-8 text-center" role="status">
          <p class="text-lg text-slate-700">Online ordering is paused at the moment.</p>
          <p class="mt-2 text-slate-600">Your cart is saved. Please contact us to place your order.</p>
          <a routerLink="/contact" class="btn-primary mt-6">Contact us</a>
        </div>
      } @else {
        <div class="grid gap-8 lg:grid-cols-3">
          <div class="space-y-8 lg:col-span-2">
            <!-- 1. Address -->
            <section class="card p-6" aria-labelledby="step-address">
              <h2 id="step-address" class="text-lg">1. Delivery address</h2>
              @if (addresses().length > 0) {
                <fieldset class="mt-4">
                  <legend class="sr-only">Choose a delivery address</legend>
                  <div class="grid gap-3 sm:grid-cols-2">
                    @for (a of addresses(); track a.id) {
                      <label class="flex cursor-pointer gap-3 rounded-xl border p-4 text-sm"
                             [class]="addressId() === a.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-300'">
                        <input type="radio" name="address" class="mt-1 h-4 w-4 text-brand-600" [value]="a.id"
                               [checked]="addressId() === a.id" (change)="addressId.set(a.id)" />
                        <span>
                          <span class="font-semibold text-brand-900">{{ a.label }}</span><br />
                          <span class="text-slate-600">{{ a.contact_name }} · {{ a.contact_phone }}<br />
                          {{ a.line1 }}@if (a.line2) {, {{ a.line2 }}}<br />{{ a.city }} – {{ a.pincode }}</span>
                        </span>
                      </label>
                    }
                  </div>
                </fieldset>
              }
              @if (addingAddress()) {
                <div class="mt-4 rounded-xl border border-slate-200 p-4">
                  <h3 class="mb-4 text-base">New address</h3>
                  <app-address-form [defaults]="{ contact_name: profile()?.full_name ?? '', contact_phone: profile()?.phone ?? '', is_default: addresses().length === 0 }"
                                    (saved)="addressAdded($event)" (cancelled)="addingAddress.set(false)" />
                </div>
              } @else {
                <button type="button" class="btn-secondary mt-4" (click)="addingAddress.set(true)">
                  {{ addresses().length ? 'Add another address' : 'Add a delivery address' }}
                </button>
              }
            </section>

            <!-- 2. Date and slot -->
            <section class="card p-6" aria-labelledby="step-slot">
              <h2 id="step-slot" class="text-lg">2. Delivery date and time</h2>
              <fieldset class="mt-4">
                <legend class="label">Date</legend>
                <div class="flex gap-2 overflow-x-auto pb-2">
                  @for (d of dates(); track d) {
                    <button type="button" class="shrink-0 rounded-xl border px-3 py-2 text-sm"
                            [class]="date() === d ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-500' : 'border-slate-200 text-slate-700 hover:border-brand-300'"
                            [attr.aria-pressed]="date() === d" (click)="chooseDate(d)">
                      {{ dayLabel(d) }}
                    </button>
                  }
                </div>
              </fieldset>
              <fieldset class="mt-4">
                <legend class="label">Time slot</legend>
                @if (slotsLoading()) {
                  <app-spinner label="Checking slots…" />
                } @else if (slotsError()) {
                  <p class="field-error" role="alert">{{ slotsError() }}</p>
                } @else if (slots().length === 0) {
                  <p class="text-sm text-slate-500">No delivery slots on this day. Please pick another date.</p>
                } @else {
                  <div class="grid gap-3 sm:grid-cols-3">
                    @for (s of slots(); track s.slot_id) {
                      <label class="flex gap-3 rounded-xl border p-3 text-sm"
                             [class]="!s.is_available ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                     : slotId() === s.slot_id ? 'cursor-pointer border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'cursor-pointer border-slate-200 hover:border-brand-300'">
                        <input type="radio" name="slot" class="mt-1 h-4 w-4 text-brand-600" [value]="s.slot_id" [disabled]="!s.is_available"
                               [checked]="slotId() === s.slot_id" (change)="slotId.set(s.slot_id)" />
                        <span>
                          <span class="font-semibold" [class.text-brand-900]="s.is_available">{{ s.label }}</span><br />
                          <span>{{ time(s.start_time) }} – {{ time(s.end_time) }}</span>
                          @if (!s.is_available) {<br /><span class="text-xs">{{ s.reason }}</span>}
                        </span>
                      </label>
                    }
                  </div>
                }
              </fieldset>
            </section>

            <!-- 3. Payment -->
            <section class="card p-6" aria-labelledby="step-pay">
              <h2 id="step-pay" class="text-lg">3. Payment</h2>
              <fieldset class="mt-4 grid gap-3 sm:grid-cols-2">
                <legend class="sr-only">How would you like to pay?</legend>
                @if (settings()!.cod_enabled) {
                  <label class="flex cursor-pointer gap-3 rounded-xl border p-4 text-sm"
                         [class]="payment() === 'cod' ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-300'">
                    <input type="radio" name="payment" class="mt-1 h-4 w-4 text-brand-600" value="cod" [checked]="payment() === 'cod'" (change)="payment.set('cod')" />
                    <span><span class="font-semibold text-brand-900">Cash / UPI on delivery</span><br />
                      <span class="text-slate-600">Pay when your order arrives.</span></span>
                  </label>
                }
                @if (settings()!.online_payment_enabled) {
                  <label class="flex cursor-pointer gap-3 rounded-xl border p-4 text-sm"
                         [class]="payment() === 'razorpay' ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-300'">
                    <input type="radio" name="payment" class="mt-1 h-4 w-4 text-brand-600" value="razorpay" [checked]="payment() === 'razorpay'" (change)="payment.set('razorpay')" />
                    <span><span class="font-semibold text-brand-900">Pay online now</span><br />
                      <span class="text-slate-600">UPI, cards, net banking or wallets, through Razorpay.</span></span>
                  </label>
                }
              </fieldset>
              <div class="mt-4">
                <label for="notes" class="label">Delivery notes (optional)</label>
                <textarea id="notes" class="input" rows="2" maxlength="500" [(ngModel)]="notes"
                          placeholder="e.g. Call before coming, 3rd floor, no lift"></textarea>
              </div>
            </section>
          </div>

          <!-- Summary -->
          <aside class="card h-fit p-6 lg:sticky lg:top-24" aria-labelledby="summary-title">
            <h2 id="summary-title" class="text-lg">Order summary</h2>
            @if (!addressId()) {
              <p class="mt-4 text-sm text-slate-500">Choose a delivery address to see the delivery charge and total.</p>
              <ul class="mt-4 space-y-1 text-sm">
                @for (l of cart.lines(); track l.product_id) {<li>{{ l.quantity }} × {{ l.name }}</li>}
              </ul>
            } @else if (quoting() && !quote()) {
              <app-spinner label="Working out your total…" />
            } @else if (quoteError()) {
              <p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ quoteError() }}</p>
            } @else if (quote(); as q) {
              <ul class="mt-4 space-y-2 text-sm" [class.opacity-60]="quoting()">
                @for (l of q.lines; track l.product_id) {
                  <li class="flex justify-between gap-3"><span>{{ l.quantity }} × {{ l.product_name }}</span><span>{{ l.line_total | rupees }}</span></li>
                }
              </ul>
              <dl class="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm" [class.opacity-60]="quoting()">
                <div class="flex justify-between"><dt>Items</dt><dd>{{ q.subtotal | rupees }}</dd></div>
                <div class="flex justify-between"><dt>Delivery ({{ q.zone_name }})</dt><dd>{{ q.delivery_charge > 0 ? (q.delivery_charge | rupees) : 'Free' }}</dd></div>
                @if (q.deposit_total > 0) {
                  <div class="flex justify-between"><dt>Refundable can deposit</dt><dd>{{ q.deposit_total | rupees }}</dd></div>
                }
                <div class="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-brand-900"><dt>Total</dt><dd>{{ q.total | rupees }}</dd></div>
              </dl>
              @if (q.deposit_total > 0) {
                <p class="mt-3 text-xs text-slate-500">The deposit is for new returnable cans. You get it back when you return the cans.</p>
              }
              @if (q.free_delivery_min && q.delivery_charge > 0 && q.subtotal < q.free_delivery_min) {
                <p class="mt-3 text-xs text-aqua-700">Add {{ q.free_delivery_min - q.subtotal | rupees }} more for free delivery.</p>
              }
              @if (belowMinimum()) {
                <p class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">The minimum order for your area is {{ q.min_order_amount | rupees }}.</p>
              }
            }
            @if (hasSamplePrices()) {
              <p class="mt-4"><span class="badge-sample">Sample prices</span></p>
            }

            @if (placeError()) {
              <p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ placeError() }}</p>
            }
            @if (missing(); as m) {
              <p class="mt-4 text-sm text-slate-500" id="place-hint">{{ m }}</p>
            }
            <button type="button" class="btn-primary mt-6 w-full" [disabled]="!!missing() || placing()" (click)="place()" aria-describedby="place-hint">
              {{ placing() ? 'Placing your order…' : payment() === 'razorpay' ? 'Place order and pay' : 'Place order' }}
            </button>
            <a routerLink="/cart" class="btn-secondary mt-3 w-full">Back to cart</a>
          </aside>
        </div>
      }
    </div>
  `,
})
export class Checkout implements OnInit {
  protected readonly cart = inject(CartService);
  private readonly api = inject(ApiService);
  private readonly payments = inject(PaymentService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly settings = signal<PublicSettings | null>(null);
  protected readonly profile = signal<Profile | null>(null);
  protected readonly addresses = signal<Address[]>([]);
  protected readonly addingAddress = signal(false);

  protected readonly addressId = signal<string | null>(null);
  protected readonly quote = signal<Quote | null>(null);
  protected readonly quoting = signal(false);
  protected readonly quoteError = signal<string | null>(null);

  protected readonly date = signal<string | null>(null);
  protected readonly slots = signal<Slot[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly slotsError = signal<string | null>(null);
  protected readonly slotId = signal<number | null>(null);

  protected readonly payment = signal<PaymentMethod | null>(null);
  protected notes = '';
  protected readonly placing = signal(false);
  protected readonly placeError = signal<string | null>(null);

  /** One key per checkout visit: a double click or a retry after a lost response never creates two orders. */
  private readonly idempotencyKey = newUuid();
  private quoteSeq = 0;
  private slotSeq = 0;

  protected readonly canOrder = computed(() => !!this.settings() && (this.settings()!.cod_enabled || this.settings()!.online_payment_enabled));
  protected readonly hasSamplePrices = computed(() => this.cart.lines().some((l) => l.is_sample_price));
  protected readonly belowMinimum = computed(() => {
    const q = this.quote();
    return !!q && Number(q.subtotal) < Number(q.min_order_amount);
  });

  /** Dates customers can choose: today up to the advance-booking limit, without closed days. */
  protected readonly dates = computed(() => {
    const s = this.settings();
    if (!s) return [];
    const closed = new Set(s.closed_dates ?? []);
    const out: string[] = [];
    for (let i = 0; i <= s.max_advance_days; i++) {
      const d = addDays(s.today, i);
      if (!closed.has(d)) out.push(d);
    }
    return out;
  });

  /** Why the order cannot be placed yet (shown under the button), or null when it can. */
  protected readonly missing = computed(() => {
    if (!this.addressId()) return 'Choose a delivery address.';
    if (this.quoteError()) return 'Please fix the problem above.';
    if (!this.quote() || this.quoting()) return 'Working out your total…';
    if (this.belowMinimum()) return 'Add more items to reach the minimum order.';
    if (!this.date() || !this.slotId()) return 'Choose a delivery date and time slot.';
    if (!this.payment()) return 'Choose how you will pay.';
    return null;
  });

  constructor() {
    // Re-price whenever the address or the cart changes.
    effect(() => {
      const addressId = this.addressId();
      const items = this.cart.lines().map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
      if (!addressId || items.length === 0) return;
      untracked(() => this.requote(addressId, items));
    });
  }

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [settings, profile, addresses, catalog] = await Promise.all([this.api.settings(), this.api.me(), this.api.addresses(), this.api.catalog()]);
      this.cart.sync(catalog.products);
      this.settings.set(settings);
      this.profile.set(profile);
      this.addresses.set(addresses);
      this.addingAddress.set(addresses.length === 0);
      this.addressId.set((addresses.find((a) => a.is_default) ?? addresses[0])?.id ?? null);
      this.payment.set(settings.cod_enabled ? 'cod' : settings.online_payment_enabled ? 'razorpay' : null);
      const first = this.dates()[0];
      if (first) this.chooseDate(first);
    } catch (e) {
      this.loadError.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected dayLabel(d: string): string {
    const today = this.settings()?.today;
    if (d === today) return 'Today';
    if (today && d === addDays(today, 1)) return 'Tomorrow';
    return formatDay(d);
  }

  /** "07:00" → "7:00 AM" */
  protected time(t: string): string {
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  protected async chooseDate(d: string) {
    const keep = d === this.date() ? this.slotId() : null;
    this.date.set(d);
    this.slotId.set(null);
    this.slotsError.set(null);
    this.slotsLoading.set(true);
    const seq = ++this.slotSeq;
    try {
      const slots = await this.api.slots(d);
      if (seq !== this.slotSeq) return;
      this.slots.set(slots);
      // Keep their choice if it is still open; pick the slot for them when only one is open.
      const open = slots.filter((s) => s.is_available);
      if (keep && open.some((s) => s.slot_id === keep)) this.slotId.set(keep);
      else if (open.length === 1) this.slotId.set(open[0].slot_id);
    } catch (e) {
      if (seq === this.slotSeq) this.slotsError.set(errorMessage(e));
    } finally {
      if (seq === this.slotSeq) this.slotsLoading.set(false);
    }
  }

  protected async addressAdded(a: Address) {
    this.addingAddress.set(false);
    this.addresses.set(await this.api.addresses().catch(() => [...this.addresses(), a]));
    this.addressId.set(a.id);
  }

  private async requote(addressId: string, items: { product_id: number; quantity: number }[]) {
    const seq = ++this.quoteSeq;
    this.quoting.set(true);
    this.quoteError.set(null);
    try {
      const q = await this.api.quote(addressId, items);
      if (seq === this.quoteSeq) this.quote.set(q);
    } catch (e) {
      if (seq === this.quoteSeq) {
        this.quote.set(null);
        this.quoteError.set(errorMessage(e));
      }
    } finally {
      if (seq === this.quoteSeq) this.quoting.set(false);
    }
  }

  protected async place() {
    if (this.missing() || this.placing()) return;
    this.placing.set(true);
    this.placeError.set(null);
    const method = this.payment()!;
    try {
      const order = await this.api.placeOrder({
        address_id: this.addressId()!,
        items: this.cart.lines().map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        delivery_date: this.date()!,
        slot_id: this.slotId()!,
        payment_method: method,
        notes: this.notes.trim() || null,
        idempotency_key: this.idempotencyKey,
      });
      this.cart.clear();

      let payment: string | null = null;
      if (method === 'razorpay') {
        const outcome = await this.payments.pay(order.id);
        payment = outcome.kind;
      }
      await this.router.navigate(['/orders', order.id], { queryParams: { placed: 1, ...(payment ? { payment } : {}) } });
    } catch (e) {
      this.placeError.set(errorMessage(e));
      // A slot may have just filled up: show the latest availability.
      if (this.date()) this.chooseDate(this.date()!);
      this.placing.set(false);
    }
  }
}

function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers without randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
