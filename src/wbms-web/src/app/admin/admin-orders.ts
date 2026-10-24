import { CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { addDays, isoDay } from '../shared/format';
import { Customer, Driver, Order, PaymentMode, Product } from '../shared/models';
import { StatusBadge } from '../shared/status-badge';

const FILTERS: { label: string; value: string }[] = [
  { label: 'To confirm', value: 'new' },
  { label: 'Awaiting payment', value: 'PaymentPending' },
  { label: 'Need a driver', value: 'Confirmed' },
  { label: 'Assigned', value: 'Assigned' },
  { label: 'Out for delivery', value: 'OutForDelivery' },
  { label: 'Completed', value: 'Completed' },
  { label: 'Cancelled', value: 'Cancelled' },
  { label: 'All', value: '' },
];

/** Confirm, assign, cancel and book phone orders. The list refreshes every 30 seconds. */
@Component({
  selector: 'app-admin-orders',
  imports: [FormsModule, CurrencyPipe, StatusBadge],
  template: `
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <h1 class="h4 mb-0 me-3">Orders</h1>
      <div class="btn-group btn-group-sm flex-wrap" role="group">
        @for (f of filters; track f.value) {
          <button class="btn" [class.btn-primary]="status() === f.value" [class.btn-outline-primary]="status() !== f.value" (click)="setStatus(f.value)">{{ f.label }}</button>
        }
      </div>
      <input type="date" class="form-control form-control-sm w-auto" [ngModel]="date()" (ngModelChange)="date.set($event); load()" title="Delivery day" />
      <button class="btn btn-sm btn-success ms-auto" (click)="showBook.set(!showBook())">{{ showBook() ? 'Close' : 'New phone order' }}</button>
    </div>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }

    @if (showBook()) {
      <div class="card mb-3"><div class="card-body">
        <h2 class="h6">Phone order</h2>
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label small" for="bc">Customer</label>
            <select id="bc" class="form-select" [(ngModel)]="bookCustomerId" (ngModelChange)="bookAddressId = defaultAddress($event)">
              <option [ngValue]="0" disabled>Choose…</option>
              @for (c of customers(); track c.id) { <option [ngValue]="c.id">{{ c.user.name }} ({{ c.user.phone }})</option> }
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label small" for="ba">Address</label>
            <select id="ba" class="form-select" [(ngModel)]="bookAddressId">
              @for (a of bookAddresses(); track a.id) { <option [ngValue]="a.id">{{ a.line }}, {{ a.area }}</option> }
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label small" for="bp">Product</label>
            <select id="bp" class="form-select" [(ngModel)]="bookProductId">
              @for (p of products(); track p.id) { <option [ngValue]="p.id">{{ p.name }} (₹{{ p.price }})</option> }
            </select>
          </div>
          <div class="col-md-1">
            <label class="form-label small" for="bq">Qty</label>
            <input id="bq" type="number" min="1" class="form-control" [(ngModel)]="bookQty" />
          </div>
          <div class="col-md-1">
            <label class="form-label small" for="bm">Payment</label>
            <select id="bm" class="form-select" [(ngModel)]="bookMode">
              <option value="Cash">Cash</option><option value="Credit">Credit</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label small" for="bd">Day</label>
            <input id="bd" type="date" class="form-control" [(ngModel)]="bookDate" />
          </div>
        </div>
        <button class="btn btn-success mt-3" (click)="book()" [disabled]="busy() || !bookCustomerId || !bookAddressId">Book order</button>
      </div></div>
    }

    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th class="text-end">Total</th><th>Status</th><th>Driver</th><th></th></tr></thead>
        <tbody>
          @for (o of orders(); track o.id) {
            <tr>
              <td><div class="fw-semibold">{{ o.orderNo }}</div><div class="small text-body-secondary">{{ o.slotDate }}</div></td>
              <td>{{ o.customerName }}<div class="small text-body-secondary">{{ o.customerPhone }} · {{ o.address }}</div></td>
              <td class="small">{{ itemsText(o) }}@if (o.notes) { <div class="text-body-secondary">“{{ o.notes }}”</div> }</td>
              <td class="text-end">{{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}<div class="small text-body-secondary">{{ o.paymentMode }}</div></td>
              <td><app-status [status]="o.status" [staff]="true" /></td>
              <td>
                @if (o.status === 'Confirmed' || o.status === 'Assigned') {
                  <select class="form-select form-select-sm" [ngModel]="o.driverId ?? 0" (ngModelChange)="assign(o, $event)">
                    <option [ngValue]="0" disabled>Assign…</option>
                    @for (d of activeDrivers(); track d.id) { <option [ngValue]="d.id">{{ d.user.name }}</option> }
                  </select>
                } @else {
                  {{ o.driverName }}
                  @if (o.status === 'OutForDelivery' && o.driverLat != null) {
                    <a class="small d-block" target="_blank" rel="noopener" [href]="'https://www.google.com/maps/search/?api=1&query=' + o.driverLat + ',' + o.driverLng">Where is it?</a>
                  }
                }
              </td>
              <td class="text-nowrap text-end">
                @if (o.status === 'Placed' || o.status === 'Paid' || o.status === 'OnCredit') {
                  <button class="btn btn-sm btn-primary me-1" (click)="confirm(o)" [disabled]="busy()">Confirm</button>
                }
                @if (o.status === 'PaymentPending') {
                  <button class="btn btn-sm btn-outline-primary me-1" (click)="recordPayment(o)" [disabled]="busy()">Mark paid</button>
                }
                @if (o.invoiceId) {
                  <button class="btn btn-sm btn-outline-secondary me-1" (click)="invoice(o)">Invoice</button>
                }
                @if (canCancel(o)) {
                  <button class="btn btn-sm btn-outline-danger" (click)="cancel(o)" [disabled]="busy()">Cancel</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="text-body-secondary py-4 text-center">No orders here.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminOrders implements OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private timer = setInterval(() => this.load(), 30_000);

  filters = FILTERS;
  status = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('status') ?? 'new');
  date = signal('');
  orders = signal<Order[]>([]);
  drivers = signal<Driver[]>([]);
  customers = signal<Customer[]>([]);
  products = signal<Product[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);
  showBook = signal(false);

  bookCustomerId = 0;
  bookAddressId = 0;
  bookProductId = 0;
  bookQty = 1;
  bookMode: PaymentMode = 'Cash';
  bookDate = isoDay(addDays(new Date(), 0));

  activeDrivers = computed(() => this.drivers().filter((d) => d.user.isActive));

  constructor() {
    this.load();
    Promise.all([this.api.drivers(), this.api.customers(), this.api.products()]).then(([d, c, p]) => {
      this.drivers.set(d);
      this.customers.set(c);
      this.products.set(p);
      this.bookProductId = p[0]?.id ?? 0;
    }, (e) => this.error.set(errorMessage(e)));
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  bookAddresses() {
    return this.customers().find((c) => c.id === this.bookCustomerId)?.addresses ?? [];
  }

  defaultAddress(customerId: number) {
    const c = this.customers().find((x) => x.id === customerId);
    return c?.addresses.find((a) => a.isDefault)?.id ?? c?.addresses[0]?.id ?? 0;
  }

  setStatus(s: string) {
    this.status.set(s);
    this.router.navigate([], { queryParams: { status: s || null }, replaceUrl: true });
    this.load();
  }

  async load() {
    try {
      const s = this.status() === 'new' ? 'Placed,Paid,OnCredit' : this.status();
      this.orders.set(await this.api.orders({ status: s, date: this.date() }));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  itemsText(o: Order) {
    return o.items.map((i) => `${i.qty} × ${i.product}`).join(', ');
  }

  canCancel(o: Order) {
    return !['OutForDelivery', 'Delivered', 'Completed', 'Cancelled', 'Failed'].includes(o.status);
  }

  private async act(fn: () => Promise<unknown>) {
    this.error.set(null);
    this.busy.set(true);
    try {
      await fn();
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  confirm(o: Order) { return this.act(() => this.api.confirm(o.id)); }
  assign(o: Order, driverId: number) { return this.act(() => this.api.assign(o.id, driverId)); }
  cancel(o: Order) {
    if (!confirm(`Cancel order ${o.orderNo} for ${o.customerName}?`)) return;
    return this.act(() => this.api.cancel(o.id));
  }
  recordPayment(o: Order) {
    const reference = prompt(`UPI / transaction reference for ₹${o.total}`);
    if (!reference) return;
    return this.act(() => this.api.recordPayment(o.id, o.total, reference));
  }
  invoice(o: Order) { return this.act(() => this.api.downloadInvoice(o.invoiceId!, o.invoiceNo!)); }

  book() {
    return this.act(async () => {
      await this.api.book({
        customerId: this.bookCustomerId, addressId: this.bookAddressId, paymentMode: this.bookMode, slotDate: this.bookDate,
        items: [{ productId: this.bookProductId, qty: this.bookQty }], notes: null,
      });
      this.showBook.set(false);
      this.setStatus('new');
    });
  }
}
