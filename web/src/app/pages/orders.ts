import { Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { BUSINESS, telLink, whatsappLink } from '../core/business';
import { OrderDetail, OrderSummary } from '../core/models';
import { PaymentService } from '../core/payment.service';
import { OrderTimeline, StatusBadge, formatDateTime, formatDay, paymentLabel } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, PageHeader, Spinner } from '../shared/ui';

@Component({
  selector: 'app-orders',
  imports: [RouterLink, RupeesPipe, StatusBadge, PageHeader, Spinner, ErrorBox],
  template: `
    <app-page-header title="My orders">
      <div class="mt-6 flex flex-wrap gap-3">
        <a routerLink="/products" class="btn-primary">Order again</a>
        <a routerLink="/account" class="btn-secondary">My account</a>
      </div>
    </app-page-header>
    <div class="container-page py-10">
      @if (loading()) {
        <app-spinner label="Loading your orders…" />
      } @else if (error()) {
        <app-error [message]="error()!" [retry]="load" />
      } @else if (orders().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-lg text-slate-700">You have not placed any orders yet.</p>
          <a routerLink="/products" class="btn-primary mt-6">Browse products</a>
        </div>
      } @else {
        <ul class="space-y-4" aria-label="Your orders">
          @for (o of orders(); track o.id) {
            <li>
              <a [routerLink]="['/orders', o.id]" class="card flex flex-wrap items-center justify-between gap-4 p-5 hover:border-brand-300">
                <div>
                  <p class="font-semibold text-brand-900">Order {{ o.order_no }}</p>
                  <p class="text-sm text-slate-500">Placed {{ when(o.created_at) }} · {{ o.item_count }} {{ o.item_count === 1 ? 'item' : 'items' }}</p>
                  <p class="mt-1 text-sm text-slate-600">Delivery: {{ day(o.delivery_date) }}, {{ o.slot_label }}</p>
                </div>
                <div class="text-right">
                  <app-status-badge [status]="o.status" />
                  <p class="mt-2 font-semibold text-brand-900">{{ o.total | rupees }}</p>
                  <p class="text-xs text-slate-500">{{ pay(o) }}</p>
                </div>
              </a>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class Orders implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly orders = signal<OrderSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly when = formatDateTime;
  protected readonly day = (d: string) => formatDay(d, true);
  protected readonly pay = (o: OrderSummary) => paymentLabel(o.payment_method, o.payment_status);

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.orders.set(await this.api.orders());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };
}

@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, RupeesPipe, StatusBadge, OrderTimeline, Spinner, ErrorBox],
  template: `
    <div class="container-page py-10">
      <a routerLink="/orders" class="text-sm font-medium text-brand-700 hover:underline">← All orders</a>
      @if (loading()) {
        <app-spinner label="Loading your order…" />
      } @else if (error()) {
        <div class="mt-6"><app-error [message]="error()!" [retry]="load" /></div>
      } @else if (order(); as o) {
        @if (banner(); as b) {
          <div class="mt-6 rounded-2xl p-5" [class]="b.tone" role="status">
            <p class="font-semibold">{{ b.title }}</p>
            <p class="mt-1 text-sm">{{ b.text }}</p>
          </div>
        }

        <div class="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-3xl">Order {{ o.order_no }}</h1>
            <p class="mt-1 text-slate-500">Placed {{ when(o.created_at) }}</p>
          </div>
          <app-status-badge [status]="o.status" />
        </div>

        @if (canPay()) {
          <div class="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p class="flex-1 text-sm text-amber-900">
              <span class="font-semibold">Payment of {{ o.total | rupees }} is pending.</span>
              Unpaid online orders are cancelled automatically after a while.
            </p>
            <button type="button" class="btn-primary" [disabled]="paying()" (click)="payNow()">{{ paying() ? 'Opening payment…' : 'Pay now' }}</button>
          </div>
        }
        @if (actionError()) {<p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ actionError() }}</p>}

        <section class="card mt-6 p-6" aria-labelledby="progress-title">
          <h2 id="progress-title" class="sr-only">Order progress</h2>
          <app-order-timeline [order]="o" />
        </section>

        <div class="mt-6 grid gap-6 lg:grid-cols-3">
          <section class="card p-6 lg:col-span-2" aria-labelledby="items-title">
            <h2 id="items-title" class="text-lg">Items</h2>
            <table class="mt-4 w-full text-sm">
              <thead class="sr-only"><tr><th>Product</th><th>Quantity</th><th>Amount</th></tr></thead>
              <tbody>
                @for (i of o.items; track $index) {
                  <tr class="border-b border-slate-100 last:border-0">
                    <td class="py-2">{{ i.product_name }} <span class="text-slate-500">({{ i.unit_label }}, {{ i.unit_price | rupees }} each)</span></td>
                    <td class="py-2 text-center">× {{ i.quantity }}</td>
                    <td class="py-2 text-right">{{ i.line_total | rupees }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <dl class="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm">
              <div class="flex justify-between"><dt>Items</dt><dd>{{ o.subtotal | rupees }}</dd></div>
              <div class="flex justify-between"><dt>Delivery</dt><dd>{{ o.delivery_charge > 0 ? (o.delivery_charge | rupees) : 'Free' }}</dd></div>
              @if (o.deposit_total > 0) {
                <div class="flex justify-between"><dt>Refundable can deposit</dt><dd>{{ o.deposit_total | rupees }}</dd></div>
              }
              <div class="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-brand-900"><dt>Total</dt><dd>{{ o.total | rupees }}</dd></div>
            </dl>
          </section>

          <div class="space-y-6">
            <section class="card p-6" aria-labelledby="delivery-title">
              <h2 id="delivery-title" class="text-lg">Delivery</h2>
              <p class="mt-3 text-sm font-semibold text-brand-900">{{ day(o.delivery_date) }}</p>
              <p class="text-sm text-slate-600">{{ o.slot_label }}</p>
              <address class="mt-3 text-sm text-slate-600 not-italic">
                {{ o.delivery_address.contact_name }} · {{ o.delivery_address.contact_phone }}<br />
                {{ o.delivery_address.line1 }}@if (o.delivery_address.line2) {, {{ o.delivery_address.line2 }}}<br />
                @if (o.delivery_address.landmark) {Near {{ o.delivery_address.landmark }}<br />}
                {{ o.delivery_address.city }} – {{ o.delivery_address.pincode }}
              </address>
              @if (o.customer_notes) {<p class="mt-3 text-sm text-slate-600">Notes: {{ o.customer_notes }}</p>}
              @if (o.status === 'delivered' && (o.cans_delivered !== null || o.empties_collected !== null)) {
                <p class="mt-3 text-sm text-slate-600">Cans delivered: {{ o.cans_delivered ?? 0 }} · Empty cans collected: {{ o.empties_collected ?? 0 }}</p>
              }
            </section>

            <section class="card p-6" aria-labelledby="payment-title">
              <h2 id="payment-title" class="text-lg">Payment</h2>
              <p class="mt-3 text-sm">{{ o.payment_method === 'cod' ? 'Cash / UPI on delivery' : 'Online (Razorpay)' }}</p>
              <p class="text-sm font-semibold text-brand-900">{{ payLabel() }}</p>
            </section>

            @if (help(); as h) {
              <section class="card p-6" aria-labelledby="help-title">
                <h2 id="help-title" class="text-lg">Need help with this order?</h2>
                <div class="mt-3 flex flex-wrap gap-2">
                  @if (h.whatsapp) {<a [href]="h.whatsapp" target="_blank" rel="noopener" class="btn-whatsapp">WhatsApp us</a>}
                  @if (h.phone) {<a [href]="h.phone" class="btn-secondary">Call {{ business.phone }}</a>}
                </div>
              </section>
            }

            @if (o.status === 'pending' && o.payment_status !== 'paid') {
              <button type="button" class="btn-secondary w-full border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                      [disabled]="cancelling()" (click)="cancel()">{{ cancelling() ? 'Cancelling…' : 'Cancel this order' }}</button>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderDetailPage implements OnInit, OnDestroy {
  /** From the route (/orders/:id) and query string (?placed=1&payment=closed). */
  readonly id = input.required<string>();
  readonly placed = input<string>();
  readonly payment = input<string>();

  private readonly api = inject(ApiService);
  private readonly payments = inject(PaymentService);

  protected readonly order = signal<OrderDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly paying = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly actionError = signal<string | null>(null);
  /** Result of the latest payment attempt on this page, overriding the query string. */
  private readonly lastPayment = signal<string | null>(null);
  private pollTimer?: ReturnType<typeof setTimeout>;
  private polls = 0;

  protected readonly when = formatDateTime;
  protected readonly day = (d: string) => formatDay(d, true);
  protected readonly business = BUSINESS;
  /** WhatsApp (with the order number filled in) and phone, when the business has set them. */
  protected readonly help = computed(() => {
    const o = this.order();
    const whatsapp = o ? whatsappLink(`Hello AquaPure Water, I have a question about my order ${o.order_no}.`) : null;
    const phone = BUSINESS.phone ? telLink(BUSINESS.phone) : null;
    return whatsapp || phone ? { whatsapp, phone } : null;
  });
  protected readonly payLabel = computed(() => {
    const o = this.order();
    return o ? paymentLabel(o.payment_method, o.payment_status) : '';
  });
  protected readonly canPay = computed(() => {
    const o = this.order();
    return !!o && o.payment_method === 'razorpay' && o.status === 'pending' && (o.payment_status === 'pending' || o.payment_status === 'failed');
  });

  protected readonly banner = computed(() => {
    const o = this.order();
    if (!o || o.status === 'cancelled') return null;
    const payment = this.lastPayment() ?? this.payment();
    if (o.payment_method === 'razorpay') {
      if (o.payment_status === 'paid' && (this.placed() || payment))
        return { tone: 'bg-green-50 text-green-900', title: 'Thank you! Your payment was received.', text: 'We will confirm your order shortly.' };
      if (payment === 'processing' || payment === 'paid')
        return { tone: 'bg-brand-50 text-brand-900', title: 'Checking your payment…', text: 'This usually takes a few seconds. This page updates by itself.' };
      if (payment === 'error')
        return { tone: 'bg-amber-50 text-amber-900', title: 'We could not confirm your payment yet.', text: 'If money was taken from your account, it will be matched to this order automatically. Otherwise you can pay below.' };
      if (payment === 'closed' || this.placed())
        return { tone: 'bg-amber-50 text-amber-900', title: 'Your order is saved, but not paid yet.', text: 'Use "Pay now" below to complete the payment.' };
      return null;
    }
    return this.placed() ? { tone: 'bg-green-50 text-green-900', title: 'Thank you! Your order has been placed.', text: 'We will confirm it shortly. Please keep the amount ready for payment on delivery.' } : null;
  });

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    clearTimeout(this.pollTimer);
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      this.order.set(await this.api.order(this.id()));
      this.pollIfConfirming();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  /** After an online payment the webhook may take a few seconds: check again a few times. */
  private pollIfConfirming() {
    const o = this.order();
    const payment = this.lastPayment() ?? this.payment();
    clearTimeout(this.pollTimer);
    if (o && o.payment_method === 'razorpay' && o.payment_status !== 'paid' && o.status !== 'cancelled'
        && (payment === 'processing' || payment === 'paid' || payment === 'error') && this.polls < 10) {
      this.polls++;
      this.pollTimer = setTimeout(() => this.load(), 3000);
    }
  }

  protected async payNow() {
    const o = this.order();
    if (!o) return;
    this.paying.set(true);
    this.actionError.set(null);
    const outcome = await this.payments.pay(o.id);
    this.paying.set(false);
    if (outcome.kind === 'error') this.actionError.set(outcome.message);
    this.lastPayment.set(outcome.kind);
    this.polls = 0;
    await this.load();
  }

  protected async cancel() {
    const o = this.order();
    if (!o || !confirm(`Cancel order ${o.order_no}?`)) return;
    this.cancelling.set(true);
    this.actionError.set(null);
    try {
      this.order.set(await this.api.cancelOrder(o.id, null));
    } catch (e) {
      this.actionError.set(errorMessage(e));
    } finally {
      this.cancelling.set(false);
    }
  }
}
