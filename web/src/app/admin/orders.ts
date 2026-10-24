import { Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { OrderStatus } from '../core/models';
import { OrderTimeline, StatusBadge, formatDateTime, formatDay, paymentLabel, statusLabel } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, AdminOrder, AdminOrderRow } from './admin-api';
import { AdminContext } from './admin-layout';
import { AdminTitle, Flash, PAGE_SIZE, Pager, downloadCsv } from './admin-ui';

const STATUSES: OrderStatus[] = ['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];

@Component({
  selector: 'app-admin-orders',
  imports: [FormsModule, RouterLink, RupeesPipe, StatusBadge, AdminTitle, Pager, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Orders">
      <button type="button" class="btn-secondary" [disabled]="rows().length === 0" (click)="exportCsv()">Download CSV</button>
    </app-admin-title>

    <form class="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" (ngSubmit)="apply()" role="search">
      <div class="lg:col-span-2">
        <label for="f-q" class="label">Search</label>
        <input id="f-q" name="q" class="input" [(ngModel)]="fq" placeholder="Order no., name or phone" />
      </div>
      <div>
        <label for="f-status" class="label">Status</label>
        <select id="f-status" name="status" class="input" [(ngModel)]="fstatus">
          <option value="">All</option>
          @for (s of statuses; track s) {<option [value]="s">{{ label(s) }}</option>}
        </select>
      </div>
      <div>
        <label for="f-date" class="label">Delivery date</label>
        <input id="f-date" name="date" type="date" class="input" [(ngModel)]="fdate" />
      </div>
      <div class="flex items-end gap-2">
        <button type="submit" class="btn-primary">Filter</button>
        <button type="button" class="btn-secondary" (click)="reset()">Clear</button>
      </div>
      <label class="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="refunds" class="h-4 w-4" [(ngModel)]="frefunds" /> Only paid orders that need a refund
      </label>
    </form>

    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error [message]="error()!" [retry]="reload" />
    } @else if (rows().length === 0) {
      <p class="card p-8 text-center text-slate-500">No orders match.</p>
    } @else {
      <div class="card relative overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th class="px-4 py-3">Order</th><th class="px-4 py-3">Customer</th><th class="px-4 py-3">Delivery</th>
              <th class="px-4 py-3">Status</th><th class="px-4 py-3">Payment</th><th class="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            @for (o of rows(); track o.id) {
              <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td class="px-4 py-3">
                  <a [routerLink]="['/admin/orders', o.id]" class="font-semibold text-brand-700 hover:underline">{{ o.order_no }}</a>
                  <div class="text-xs text-slate-500">{{ when(o.created_at) }}</div>
                </td>
                <td class="px-4 py-3">{{ o.customer_name || '—' }}<div class="text-xs text-slate-500">{{ o.customer_phone }} · {{ o.pincode }}</div></td>
                <td class="px-4 py-3">{{ day(o.delivery_date) }}<div class="text-xs text-slate-500">{{ o.slot_label }}</div></td>
                <td class="px-4 py-3"><app-status-badge [status]="o.status" /></td>
                <td class="px-4 py-3">
                  {{ pay(o) }}
                  @if (o.needs_refund) {<div class="text-xs font-semibold text-red-700">Needs refund</div>}
                </td>
                <td class="px-4 py-3 text-right font-semibold">{{ o.total | rupees }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <app-pager [page]="pageNo()" [hasMore]="rows().length === pageSize" (go)="goPage($event)" />
    }
  `,
})
export class AdminOrders {
  /** Filters live in the address bar, so a filtered list can be bookmarked or refreshed. */
  readonly status = input<string>();
  readonly date = input<string>();
  readonly q = input<string>();
  readonly refunds = input<string>();
  readonly page = input<string>();

  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  protected readonly statuses = STATUSES;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly label = statusLabel;
  protected readonly when = formatDateTime;
  protected readonly day = formatDay;
  protected readonly pay = (o: AdminOrderRow) => paymentLabel(o.payment_method, o.payment_status);

  protected readonly rows = signal<AdminOrderRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly pageNo = computed(() => Math.max(1, Number(this.page()) || 1));

  protected fq = '';
  protected fstatus = '';
  protected fdate = '';
  protected frefunds = false;

  constructor() {
    effect(() => {
      const query = { status: this.status(), date: this.date(), q: this.q(), refunds: this.refunds() === 'true', page: this.pageNo() };
      untracked(() => {
        this.fq = query.q ?? '';
        this.fstatus = query.status ?? '';
        this.fdate = query.date ?? '';
        this.frefunds = query.refunds;
        this.load(query);
      });
    });
  }

  protected readonly reload = () =>
    this.load({ status: this.status(), date: this.date(), q: this.q(), refunds: this.refunds() === 'true', page: this.pageNo() });

  private async load(query: Record<string, string | number | boolean | undefined>) {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set(await this.api.orders(query));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected apply() {
    this.router.navigate([], {
      queryParams: { q: this.fq.trim() || null, status: this.fstatus || null, date: this.fdate || null, refunds: this.frefunds || null, page: null },
    });
  }

  protected reset() {
    this.router.navigate([], { queryParams: {} });
  }

  protected goPage(n: number) {
    this.router.navigate([], { queryParams: { page: n > 1 ? n : null }, queryParamsHandling: 'merge' });
  }

  protected exportCsv() {
    downloadCsv('aquapure-orders.csv', [
      ['Order', 'Placed', 'Customer', 'Phone', 'Pincode', 'Delivery date', 'Slot', 'Status', 'Payment', 'Total'],
      ...this.rows().map((o) => [o.order_no, o.created_at, o.customer_name, o.customer_phone, o.pincode, o.delivery_date, o.slot_label,
        statusLabel(o.status), paymentLabel(o.payment_method, o.payment_status), o.total]),
    ]);
  }
}

@Component({
  selector: 'app-admin-order',
  imports: [FormsModule, RouterLink, RupeesPipe, StatusBadge, OrderTimeline, Flash, Spinner, ErrorBox],
  template: `
    <a routerLink="/admin/orders" class="text-sm font-medium text-brand-700 hover:underline print:hidden">← Orders</a>
    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <div class="mt-4"><app-error [message]="error()!" [retry]="load" /></div>
    } @else if (o(); as o) {
      <div class="mt-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl">Order {{ o.order_no }}</h1>
          <p class="text-sm text-slate-500">Placed {{ when(o.created_at) }}</p>
        </div>
        <div class="flex items-center gap-3">
          <app-status-badge [status]="o.status" />
          <button type="button" class="btn-secondary print:hidden" (click)="print()">Print slip</button>
        </div>
      </div>

      <div class="mb-4"><app-flash [message]="msg()" [error]="msgErr()" /></div>

      <section class="card mb-6 p-5 print:hidden" aria-labelledby="actions-title">
        <h2 id="actions-title" class="text-base">Next step</h2>
        @if (o.status === 'delivered' || o.status === 'cancelled') {
          <p class="mt-2 text-sm text-slate-500">This order is {{ label(o.status).toLowerCase() }}. No more status changes.</p>
        } @else {
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label for="status-note" class="label">Note for the history (optional)</label>
              <input id="status-note" class="input" maxlength="500" [(ngModel)]="note" />
            </div>
            @if (o.status === 'out_for_delivery') {
              <div>
                <label for="cans" class="label">Full cans delivered</label>
                <input id="cans" type="number" min="0" class="input" [(ngModel)]="cans" placeholder="Leave empty to count from the order" />
              </div>
              <div>
                <label for="empties" class="label">Empty cans collected</label>
                <input id="empties" type="number" min="0" class="input" [(ngModel)]="empties" />
              </div>
            }
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            @if (o.status === 'pending') {
              <button type="button" class="btn-primary" [disabled]="busy() || awaitingPayment()" (click)="setStatus('confirmed')">Confirm order</button>
            }
            @if (o.status === 'confirmed') {
              <button type="button" class="btn-primary" [disabled]="busy()" (click)="setStatus('out_for_delivery')">Out for delivery</button>
            }
            @if (o.status === 'out_for_delivery') {
              <button type="button" class="btn-primary" [disabled]="busy()" (click)="setStatus('delivered')">Mark delivered</button>
              <button type="button" class="btn-secondary" [disabled]="busy()" (click)="setStatus('confirmed')">Back to confirmed</button>
            }
            <button type="button" class="btn-secondary border-red-200 text-red-700 hover:bg-red-50" [disabled]="busy()" (click)="setStatus('cancelled')">Cancel order</button>
          </div>
          @if (awaitingPayment()) {
            <p class="mt-3 text-sm text-amber-800">Waiting for the online payment. The order can be confirmed once it is paid.</p>
          }
        }
        @if (o.payment_method === 'cod' && o.payment_status === 'unpaid' && o.status !== 'cancelled') {
          <div class="mt-4 border-t border-slate-100 pt-4">
            <button type="button" class="btn-secondary" [disabled]="busy()" (click)="codPaid()">Cash / UPI received ({{ o.total | rupees }})</button>
          </div>
        }
        @if (o.needs_refund) {
          <div class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-900">
            <p class="font-semibold">This order was paid but cancelled (or paid twice). Refund the customer.</p>
            @if (ctx.isAdmin()) {
              <p class="mt-1">Refund it in the Razorpay Dashboard (or in cash), then record it here.</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <label for="refund-note" class="sr-only">Refund note</label>
                <input id="refund-note" class="input max-w-sm" [(ngModel)]="refundNote" placeholder="e.g. Razorpay refund rfnd_…" />
                <button type="button" class="btn-primary" [disabled]="busy()" (click)="refunded()">Mark refunded</button>
              </div>
            } @else {
              <p class="mt-1">Ask an admin to record the refund.</p>
            }
          </div>
        }
      </section>

      <section class="card mb-6 p-5"><app-order-timeline [order]="o" /></section>

      <div class="grid gap-6 lg:grid-cols-3">
        <section class="card p-5 lg:col-span-2" aria-labelledby="items-title">
          <h2 id="items-title" class="text-base">Items</h2>
          <table class="mt-3 w-full text-sm">
            <thead class="text-left text-xs text-slate-500 uppercase"><tr><th class="py-1">Product</th><th class="py-1 text-center">Qty</th><th class="py-1 text-center">New cans (deposit)</th><th class="py-1 text-right">Amount</th></tr></thead>
            <tbody>
              @for (i of o.items; track $index) {
                <tr class="border-t border-slate-100">
                  <td class="py-2">{{ i.product_name }}<div class="text-xs text-slate-500">{{ i.unit_label }} · {{ i.unit_price | rupees }}</div></td>
                  <td class="py-2 text-center">{{ i.quantity }}</td>
                  <td class="py-2 text-center">{{ i.deposit_qty || '—' }}</td>
                  <td class="py-2 text-right">{{ i.line_total | rupees }}</td>
                </tr>
              }
            </tbody>
          </table>
          <dl class="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div class="flex justify-between"><dt>Items</dt><dd>{{ o.subtotal | rupees }}</dd></div>
            <div class="flex justify-between"><dt>Delivery</dt><dd>{{ o.delivery_charge | rupees }}</dd></div>
            <div class="flex justify-between"><dt>Can deposit</dt><dd>{{ o.deposit_total | rupees }}</dd></div>
            <div class="flex justify-between font-semibold text-brand-900"><dt>Total</dt><dd>{{ o.total | rupees }}</dd></div>
          </dl>
          @if (o.payments.length) {
            <h3 class="mt-5 text-sm">Payments</h3>
            <ul class="mt-2 space-y-1 text-sm">
              @for (p of o.payments; track $index) {
                <li class="flex flex-wrap justify-between gap-2">
                  <span>{{ p.provider === 'cash' ? 'Cash / UPI' : 'Razorpay' }} · {{ p.status }}@if (p.method) { · {{ p.method }}}
                    @if (p.razorpay_payment_id) {<span class="text-xs text-slate-500"> ({{ p.razorpay_payment_id }})</span>}
                    @if (p.error_description) {<span class="text-xs text-red-700"> – {{ p.error_description }}</span>}</span>
                  <span>{{ p.amount | rupees }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <div class="space-y-6">
          <section class="card p-5" aria-labelledby="cust-title">
            <h2 id="cust-title" class="text-base">Deliver to</h2>
            <p class="mt-2 font-semibold">{{ day(o.delivery_date) }} · {{ o.slot_label }}</p>
            <address class="mt-2 text-sm not-italic">
              {{ o.delivery_address.contact_name }} · <a class="text-brand-700 underline" [href]="'tel:' + o.delivery_address.contact_phone">{{ o.delivery_address.contact_phone }}</a><br />
              {{ o.delivery_address.line1 }}@if (o.delivery_address.line2) {, {{ o.delivery_address.line2 }}}<br />
              @if (o.delivery_address.landmark) {Near {{ o.delivery_address.landmark }}<br />}
              {{ o.delivery_address.city }} – {{ o.delivery_address.pincode }}
            </address>
            @if (o.customer_notes) {<p class="mt-2 rounded-lg bg-amber-50 p-2 text-sm">Customer note: {{ o.customer_notes }}</p>}
            <p class="mt-3 text-sm">Payment: <strong>{{ pay(o) }}</strong> ({{ o.payment_method === 'cod' ? 'on delivery' : 'online' }})</p>
            @if (o.status === 'delivered') {
              <p class="mt-1 text-sm">Cans delivered: {{ o.cans_delivered ?? '—' }} · Empties collected: {{ o.empties_collected ?? '—' }}</p>
            }
            @if (o.customer) {
              <p class="mt-3 text-sm print:hidden">Customer: <a class="text-brand-700 underline" [routerLink]="['/admin/customers', o.customer.id]">{{ o.customer.full_name || o.customer.email }}</a></p>
            }
          </section>

          <section class="card p-5 print:hidden" aria-labelledby="notes-title">
            <h2 id="notes-title" class="text-base">Staff notes</h2>
            <label for="admin-notes" class="sr-only">Staff notes (not shown to the customer)</label>
            <textarea id="admin-notes" class="input mt-2" rows="3" maxlength="1000" [(ngModel)]="notes"></textarea>
            <p class="mt-1 text-xs text-slate-500">Not shown to the customer.</p>
            <button type="button" class="btn-secondary mt-2" [disabled]="busy()" (click)="saveNotes()">Save notes</button>
          </section>
        </div>
      </div>
    }
  `,
})
export class AdminOrderDetail implements OnInit {
  readonly id = input.required<string>();
  private readonly api = inject(AdminApi);
  protected readonly ctx = inject(AdminContext);

  protected readonly o = signal<AdminOrder | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly msg = signal<string | null>(null);
  protected readonly msgErr = signal(false);
  protected readonly awaitingPayment = computed(() => {
    const o = this.o();
    return !!o && o.status === 'pending' && o.payment_method === 'razorpay' && o.payment_status !== 'paid';
  });

  protected note = '';
  protected cans: number | null = null;
  protected empties: number | null = null;
  protected notes = '';
  protected refundNote = '';

  protected readonly label = statusLabel;
  protected readonly when = formatDateTime;
  protected readonly day = (d: string) => formatDay(d, true);
  protected readonly pay = (o: AdminOrder) => paymentLabel(o.payment_method, o.payment_status);

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      this.show(await this.api.order(this.id()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  private show(o: AdminOrder) {
    this.o.set(o);
    this.notes = o.admin_notes ?? '';
  }

  private async run(action: () => Promise<AdminOrder>, done: string) {
    this.busy.set(true);
    this.msg.set(null);
    try {
      this.show(await action());
      this.msgErr.set(false);
      this.msg.set(done);
    } catch (e) {
      this.msgErr.set(true);
      this.msg.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async setStatus(status: OrderStatus) {
    const o = this.o()!;
    if (status === 'cancelled' && !confirm(`Cancel order ${o.order_no}?` + (o.payment_status === 'paid' ? ' It is paid, so it will be flagged for a refund.' : ''))) return;
    const delivered = status === 'delivered';
    await this.run(
      () => this.api.setStatus(o.id, {
        status,
        note: this.note.trim() || null,
        cans_delivered: delivered && this.cans !== null && String(this.cans) !== '' ? Number(this.cans) : null,
        empties_collected: delivered && this.empties !== null && String(this.empties) !== '' ? Number(this.empties) : null,
      }),
      `Order marked as ${statusLabel(status).toLowerCase()}.`,
    );
    if (!this.msgErr()) this.note = '';
  }

  protected codPaid() {
    if (!confirm('Record that the customer has paid this order?')) return;
    return this.run(() => this.api.markCodPaid(this.o()!.id), 'Payment recorded.');
  }

  protected refunded() {
    if (!confirm('Record that this order has been refunded?')) return;
    return this.run(() => this.api.markRefunded(this.o()!.id, this.refundNote.trim() || null), 'Refund recorded.');
  }

  protected saveNotes() {
    return this.run(() => this.api.setNotes(this.o()!.id, this.notes.trim() || null), 'Notes saved.');
  }

  protected print() {
    window.print();
  }
}
