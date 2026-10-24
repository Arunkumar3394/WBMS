import { Component, computed, input } from '@angular/core';
import { OrderDetail, OrderStatus, PaymentMethod, PaymentStatus } from '../core/models';

/** Times are shown in the business's time zone, so customers and staff see the same thing. */
const TIME_ZONE = 'Asia/Kolkata';

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Placed',
  confirmed: 'Confirmed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function statusLabel(s: OrderStatus): string {
  return STATUS_LABELS[s] ?? s;
}

export function paymentLabel(method: PaymentMethod, status: PaymentStatus): string {
  switch (status) {
    case 'paid':
      return method === 'cod' ? 'Paid on delivery' : 'Paid online';
    case 'refunded':
      return 'Refunded';
    case 'failed':
      return 'Payment failed';
    case 'pending':
      return 'Payment pending';
    default:
      return method === 'cod' ? 'Pay on delivery' : 'Not paid';
  }
}

/** A calendar date such as "2026-10-25" → "Sun, 25 Oct". */
export function formatDay(date: string, withYear = false): string {
  const d = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** A timestamp → "25 Oct 2026, 9:41 am". */
export function formatDateTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });
}

/** Adds days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-status-badge',
  template: `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1" [class]="tone()">{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<OrderStatus>();
  protected readonly label = computed(() => statusLabel(this.status()));
  protected readonly tone = computed(() => {
    switch (this.status()) {
      case 'delivered':
        return 'bg-green-50 text-green-800 ring-green-200';
      case 'cancelled':
        return 'bg-slate-100 text-slate-600 ring-slate-200';
      case 'out_for_delivery':
        return 'bg-aqua-50 text-aqua-700 ring-aqua-200';
      default:
        return 'bg-brand-50 text-brand-700 ring-brand-200';
    }
  });
}

/** Placed → Confirmed → Out for delivery → Delivered, with the time each step happened. */
@Component({
  selector: 'app-order-timeline',
  template: `
    @if (order().status === 'cancelled') {
      <div class="rounded-xl bg-slate-50 p-4 text-sm">
        <p class="font-semibold text-slate-800">This order was cancelled</p>
        @if (order().cancelled_at) {<p class="text-slate-500">{{ when(order().cancelled_at!) }}</p>}
        @if (order().cancel_reason) {<p class="mt-1 text-slate-600">Reason: {{ order().cancel_reason }}</p>}
      </div>
    } @else {
      <ol class="grid gap-4 sm:grid-cols-4" aria-label="Order progress">
        @for (step of steps(); track step.status; let i = $index) {
          <li class="flex gap-3 sm:flex-col sm:gap-2" [attr.aria-current]="step.current ? 'step' : null">
            <div class="flex items-center gap-2 sm:w-full">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                    [class]="step.done ? 'bg-brand-600 text-white' : 'border-2 border-slate-200 bg-white text-slate-400'">
                @if (step.done) {<span aria-hidden="true">✓</span>} @else {<span>{{ i + 1 }}</span>}
              </span>
              @if (i < steps().length - 1) {
                <span class="hidden h-0.5 flex-1 sm:block" [class]="steps()[i + 1].done ? 'bg-brand-600' : 'bg-slate-200'" aria-hidden="true"></span>
              }
            </div>
            <div>
              <p class="text-sm font-semibold" [class]="step.done ? 'text-brand-900' : 'text-slate-500'">
                {{ step.label }}<span class="sr-only">{{ step.done ? ' (done)' : ' (not yet)' }}</span>
              </p>
              @if (step.at) {<p class="text-xs text-slate-500">{{ when(step.at) }}</p>}
            </div>
          </li>
        }
      </ol>
    }
  `,
})
export class OrderTimeline {
  readonly order = input.required<Pick<OrderDetail, 'status' | 'history' | 'created_at' | 'cancelled_at' | 'cancel_reason'>>();
  protected readonly when = formatDateTime;

  protected readonly steps = computed(() => {
    const o = this.order();
    const flow: OrderStatus[] = ['pending', 'confirmed', 'out_for_delivery', 'delivered'];
    const reached = flow.indexOf(o.status);
    // Latest time each status was entered (an order can go back from "out for delivery" to "confirmed").
    const at = new Map<OrderStatus, string>();
    for (const h of o.history) at.set(h.to_status, h.created_at);
    return flow.map((status, i) => ({
      status,
      label: statusLabel(status),
      done: i <= reached,
      current: i === reached,
      at: i <= reached ? (at.get(status) ?? (status === 'pending' ? o.created_at : null)) : null,
    }));
  });
}
