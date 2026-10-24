import { OrderStatus } from './models';

/** What a customer reads for each order status. */
export const STATUS_TEXT: Record<OrderStatus, string> = {
  Placed: 'Waiting for confirmation',
  PaymentPending: 'Waiting for payment',
  Paid: 'Paid, waiting for confirmation',
  OnCredit: 'On credit, waiting for confirmation',
  Confirmed: 'Confirmed',
  Assigned: 'Driver assigned',
  OutForDelivery: 'On the way',
  Delivered: 'Delivered',
  Completed: 'Delivered',
  Cancelled: 'Cancelled',
  Failed: 'Not delivered',
};

/** Bootstrap colour for a status badge. */
export function statusColor(s: OrderStatus): string {
  switch (s) {
    case 'PaymentPending': return 'warning';
    case 'OutForDelivery': return 'primary';
    case 'Completed': case 'Delivered': return 'success';
    case 'Cancelled': case 'Failed': return 'secondary';
    case 'Confirmed': case 'Assigned': return 'info';
    default: return 'light';
  }
}

export function isActive(s: OrderStatus) {
  return !['Completed', 'Cancelled', 'Failed'].includes(s);
}

/** A date as yyyy-MM-dd in the user's time zone (what the API expects for delivery days). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
