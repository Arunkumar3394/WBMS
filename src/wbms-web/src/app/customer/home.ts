import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { addDays, isActive, isoDay } from '../shared/format';
import { Order, PaymentMode, Product, Profile } from '../shared/models';
import { StatusBadge } from '../shared/status-badge';

/** The customer's home: what they owe, cans they hold, open orders, and the booking form. */
@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink, CurrencyPipe, StatusBadge],
  template: `
    @if (profile(); as p) {
      <h1 class="h4 mb-3">Hello, {{ p.name }}</h1>
      <div class="row g-3 mb-4">
        <div class="col-4"><div class="stat card"><div class="card-body">
          <div class="stat-label">You owe</div>
          <div class="stat-value" [class.text-danger]="(p.balance ?? 0) > 0">{{ (p.balance ?? 0) | currency: 'INR' : 'symbol' : '1.0-0' }}</div>
        </div></div></div>
        <div class="col-4"><div class="stat card"><div class="card-body">
          <div class="stat-label">Cans with you</div>
          <div class="stat-value">{{ p.cansHeld ?? 0 }}</div>
        </div></div></div>
        <div class="col-4"><div class="stat card"><div class="card-body">
          @if ((p.creditLimit ?? 0) > 0) {
            <div class="stat-label">Credit left</div>
            <div class="stat-value">{{ creditLeft() | currency: 'INR' : 'symbol' : '1.0-0' }}</div>
          } @else {
            <div class="stat-label">Orders on the way</div>
            <div class="stat-value">{{ openOrders().length }}</div>
          }
        </div></div></div>
      </div>

      @if (openOrders().length) {
        <h2 class="h6 text-uppercase text-body-secondary">Your orders on the way</h2>
        <div class="list-group mb-4">
          @for (o of openOrders(); track o.id) {
            <a class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" [routerLink]="['/orders', o.id]">
              <span>
                <span class="fw-semibold">{{ itemsText(o) }}</span>
                <span class="text-body-secondary small d-block">{{ o.slotDate }} · {{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
              </span>
              <app-status [status]="o.status" />
            </a>
          }
        </div>
      }

      <div class="card shadow-sm">
        <div class="card-body p-4">
          <h2 class="h5 mb-3">Book water</h2>
          @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }

          @for (prod of products(); track prod.id) {
            <div class="d-flex align-items-center justify-content-between border-bottom py-2">
              <div>
                <div class="fw-semibold">{{ prod.name }}</div>
                <div class="text-body-secondary small">{{ prod.price | currency: 'INR' : 'symbol' : '1.0-0' }} each</div>
              </div>
              <div class="input-group qty">
                <button class="btn btn-outline-secondary" type="button" (click)="change(prod, -1)" [attr.aria-label]="'Fewer ' + prod.name">−</button>
                <span class="input-group-text bg-body justify-content-center">{{ qty()[prod.id] ?? 0 }}</span>
                <button class="btn btn-outline-secondary" type="button" (click)="change(prod, 1)" [attr.aria-label]="'More ' + prod.name">+</button>
              </div>
            </div>
          }

          <div class="row g-3 mt-1">
            <div class="col-md-6">
              <label class="form-label" for="address">Deliver to</label>
              <select id="address" class="form-select" [(ngModel)]="addressId">
                @for (a of p.addresses; track a.id) { <option [ngValue]="a.id">{{ a.line }}{{ a.area ? ', ' + a.area : '' }}</option> }
              </select>
              <a class="small" routerLink="/account">Add another address</a>
            </div>
            <div class="col-md-6">
              <label class="form-label" for="day">Delivery day</label>
              <select id="day" class="form-select" [(ngModel)]="slotDate">
                <option [ngValue]="today">Today</option>
                <option [ngValue]="tomorrow">Tomorrow</option>
                <option [ngValue]="dayAfter">{{ dayAfterLabel }}</option>
              </select>
            </div>
          </div>

          <label class="form-label mt-3 d-block">Payment</label>
          <div class="d-flex flex-column gap-2">
            <label class="pay-option"><input type="radio" class="form-check-input me-2" name="pay" value="Cash" [(ngModel)]="paymentMode" /> Cash on delivery</label>
            <label class="pay-option"><input type="radio" class="form-check-input me-2" name="pay" value="Razorpay" [(ngModel)]="paymentMode" /> Pay now online (UPI, card, net banking)</label>
            @if ((p.creditLimit ?? 0) > 0) {
              <label class="pay-option"><input type="radio" class="form-check-input me-2" name="pay" value="Credit" [(ngModel)]="paymentMode" /> Add to my account (pay later)</label>
            }
          </div>

          <label class="form-label mt-3" for="notes">Note for the driver (optional)</label>
          <input id="notes" class="form-control" [(ngModel)]="notes" placeholder="e.g. Ring the bell twice" />

          <div class="d-flex align-items-center justify-content-between mt-4">
            <div class="fs-5">Total <strong>{{ total() | currency: 'INR' : 'symbol' : '1.0-0' }}</strong></div>
            <button class="btn btn-primary btn-lg" (click)="book()" [disabled]="busy() || total() === 0">
              {{ paymentMode === 'Razorpay' ? 'Book and pay' : 'Book' }}
            </button>
          </div>
        </div>
      </div>
    } @else if (error()) {
      <div class="alert alert-danger">{{ error() }}</div>
    } @else {
      <p class="text-body-secondary">Loading…</p>
    }
  `,
})
export class Home {
  private api = inject(ApiService);
  private router = inject(Router);

  profile = signal<Profile | null>(null);
  products = signal<Product[]>([]);
  orders = signal<Order[]>([]);
  qty = signal<Partial<Record<number, number>>>({});
  busy = signal(false);
  error = signal<string | null>(null);

  today = isoDay(new Date());
  tomorrow = isoDay(addDays(new Date(), 1));
  dayAfter = isoDay(addDays(new Date(), 2));
  dayAfterLabel = addDays(new Date(), 2).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  slotDate = this.today;
  addressId = 0;
  paymentMode: PaymentMode = 'Cash';
  notes = '';

  openOrders = computed(() => this.orders().filter((o) => isActive(o.status)));
  creditLeft = computed(() => Math.max(0, (this.profile()?.creditLimit ?? 0) - (this.profile()?.balance ?? 0)));
  total = computed(() => this.products().reduce((sum, p) => sum + p.price * (this.qty()[p.id] ?? 0), 0));

  constructor() {
    this.load();
  }

  async load() {
    try {
      const [p, products, orders] = await Promise.all([this.api.me(), this.api.products(), this.api.orders()]);
      this.profile.set(p);
      this.products.set(products);
      this.orders.set(orders);
      this.addressId = p.addresses.find((a) => a.isDefault)?.id ?? p.addresses[0]?.id ?? 0;
      const can = products.find((x) => x.isReturnable);
      if (can && Object.keys(this.qty()).length === 0) this.qty.set({ [can.id]: 2 });
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  change(p: Product, by: number) {
    this.qty.update((q) => ({ ...q, [p.id]: Math.max(0, Math.min(99, (q[p.id] ?? 0) + by)) }));
  }

  itemsText(o: Order) {
    return o.items.map((i) => `${i.qty} × ${i.product}`).join(', ');
  }

  async book() {
    this.error.set(null);
    this.busy.set(true);
    try {
      const items = Object.entries(this.qty()).filter(([, n]) => (n ?? 0) > 0).map(([id, n]) => ({ productId: +id, qty: n ?? 0 }));
      const order = await this.api.book({
        addressId: this.addressId, paymentMode: this.paymentMode, slotDate: this.slotDate, items, notes: this.notes || null,
      });
      if (order.paymentMode === 'Razorpay') {
        try {
          const link = await this.api.paymentLink(order.id);
          window.location.href = link.url;
          return;
        } catch (e) {
          // The order exists; let them retry payment or cancel from its page.
          this.router.navigate(['/orders', order.id], { state: { error: errorMessage(e) } });
          return;
        }
      }
      this.router.navigate(['/orders', order.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
