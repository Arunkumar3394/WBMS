import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { BUSINESS } from './business';

/** What happened after the customer was shown the Razorpay payment window. */
export type PaymentOutcome =
  | { kind: 'paid' }
  /** Money taken but Razorpay has not confirmed it yet; the webhook will finish it. */
  | { kind: 'processing' }
  /** The customer closed the window without paying (a failed attempt may come before this). */
  | { kind: 'closed'; lastError: string | null }
  /** We could not open the payment window or check the payment. */
  | { kind: 'error'; message: string };

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error: { code?: string; description?: string; metadata?: { order_id?: string; payment_id?: string } } }) => void): void;
}
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Online payment with Razorpay Checkout. The amount comes from the server, and success is only
 * believed after the API has checked the signature and asked Razorpay (see PaymentsController).
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly api = inject(ApiService);
  private scriptPromise?: Promise<RazorpayConstructor>;

  async pay(orderId: string): Promise<PaymentOutcome> {
    let Razorpay: RazorpayConstructor;
    let checkout;
    try {
      [Razorpay, checkout] = await Promise.all([this.loadScript(), this.api.startPayment(orderId)]);
    } catch (e) {
      return { kind: 'error', message: e instanceof Error ? e.message : 'Could not start the payment. Please try again.' };
    }

    return new Promise<PaymentOutcome>((resolve) => {
      let lastError: string | null = null;
      const rzp = new Razorpay({
        key: checkout.key_id,
        order_id: checkout.razorpay_order_id,
        amount: checkout.amount_paise,
        currency: checkout.currency,
        name: BUSINESS.name,
        description: 'Order ' + checkout.order_no,
        prefill: {
          name: checkout.prefill.name ?? undefined,
          email: checkout.prefill.email ?? undefined,
          contact: checkout.prefill.contact ?? undefined,
        },
        notes: { order_no: checkout.order_no },
        theme: { color: '#1d4ed8' },
        retry: { enabled: true },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const v = await this.api.verifyPayment(r);
            resolve(v.result === 'processing' ? { kind: 'processing' } : { kind: 'paid' });
          } catch (e) {
            // The webhook still records a real payment, so don't tell the customer it failed.
            resolve({ kind: 'error', message: e instanceof Error ? e.message : 'We could not confirm the payment yet.' });
          }
        },
        modal: {
          ondismiss: () => resolve({ kind: 'closed', lastError }),
          confirm_close: true,
        },
      });
      // A failed attempt: Razorpay keeps the window open so the customer can try again.
      rzp.on('payment.failed', (r) => {
        lastError = r.error?.description ?? 'The payment failed.';
        this.api
          .paymentFailed({
            razorpay_order_id: r.error?.metadata?.order_id ?? checkout.razorpay_order_id,
            razorpay_payment_id: r.error?.metadata?.payment_id ?? null,
            code: r.error?.code?.slice(0, 100) ?? null,
            description: lastError.slice(0, 500),
          })
          .catch(() => undefined);
      });
      rzp.open();
    });
  }

  private loadScript(): Promise<RazorpayConstructor> {
    const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
    if (existing) return Promise.resolve(existing);
    return (this.scriptPromise ??= new Promise<RazorpayConstructor>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = () => {
        const R = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
        if (R) resolve(R);
        else reject(new Error('Could not load the payment window. Please try again.'));
      };
      s.onerror = () => {
        this.scriptPromise = undefined;
        s.remove();
        reject(new Error('Could not load the payment window. Please check your internet connection and try again.'));
      };
      document.head.appendChild(s);
    }));
  }
}
