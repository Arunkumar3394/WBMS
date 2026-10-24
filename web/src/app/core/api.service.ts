import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from './app-config';
import {
  Address, AddressInput, Catalog, CustomerType, EnquiryRequest, OrderDetail, OrderItemInput, OrderSummary, PincodeCheck, PlaceOrderRequest,
  Product, Profile, PublicSettings, Quote, RazorpayCheckout, RazorpaySuccess, Slot, Testimonial,
} from './models';

/** Calls the AquaPure API. Errors become ApiError with a message that is safe to show. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl + '/api';

  get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return this.run(this.http.get<T>(this.base + path, { params: p }));
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.run(this.http.post<T>(this.base + path, body));
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.run(this.http.put<T>(this.base + path, body));
  }

  delete<T>(path: string): Promise<T> {
    return this.run(this.http.delete<T>(this.base + path));
  }

  // ---------- Public endpoints ----------
  catalog = () => this.get<Catalog>('/catalog');
  product = (slug: string) => this.get<Product>('/catalog/products/' + encodeURIComponent(slug));
  settings = () => this.get<PublicSettings>('/settings');
  checkPincode = (pincode: string) => this.get<PincodeCheck>('/delivery/check', { pincode });
  slots = (date: string) => this.get<Slot[]>('/delivery/slots', { date });
  testimonials = () => this.get<Testimonial[]>('/testimonials');
  submitEnquiry = (e: EnquiryRequest) => this.post<{ ok: boolean; id?: string }>('/enquiries', e);

  // ---------- Signed-in customer ----------
  me = () => this.get<Profile>('/me');
  updateMe = (p: { full_name: string; phone: string | null; customer_type: CustomerType }) => this.put<Profile>('/me', p);
  addresses = () => this.get<Address[]>('/me/addresses');
  addAddress = (a: AddressInput) => this.post<Address>('/me/addresses', a);
  updateAddress = (id: string, a: AddressInput) => this.put<Address>('/me/addresses/' + id, a);
  makeDefaultAddress = (id: string) => this.post<Address>('/me/addresses/' + id + '/default');
  deleteAddress = (id: string) => this.delete<{ ok: boolean }>('/me/addresses/' + id);

  // ---------- Orders ----------
  quote = (address_id: string, items: OrderItemInput[]) => this.post<Quote>('/orders/quote', { address_id, items });
  placeOrder = (r: PlaceOrderRequest) => this.post<OrderDetail>('/orders', r);
  orders = () => this.get<OrderSummary[]>('/orders');
  order = (id: string) => this.get<OrderDetail>('/orders/' + encodeURIComponent(id));
  cancelOrder = (id: string, reason: string | null) => this.post<OrderDetail>('/orders/' + encodeURIComponent(id) + '/cancel', { reason });

  // ---------- Online payment (Razorpay) ----------
  startPayment = (order_id: string) => this.post<RazorpayCheckout>('/payments/razorpay/order', { order_id });
  verifyPayment = (r: RazorpaySuccess) => this.post<{ result: string; order_id: string }>('/payments/razorpay/verify', r);
  paymentFailed = (r: { razorpay_order_id: string; razorpay_payment_id?: string | null; code?: string | null; description?: string | null }) =>
    this.post<{ order_id: string }>('/payments/razorpay/failed', r);

  private async run<T>(request: import('rxjs').Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (e) {
      throw ApiError.from(e);
    }
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }

  static from(e: unknown): ApiError {
    if (e instanceof ApiError) return e;
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) return new ApiError('Cannot reach AquaPure right now. Please check your internet connection and try again.', 0);
      const message = typeof e.error?.error === 'string' ? e.error.error : 'Something went wrong. Please try again in a moment.';
      return new ApiError(message, e.status);
    }
    return new ApiError('Something went wrong. Please try again in a moment.', -1);
  }
}

/** Message to show for any error thrown by the API service. */
export function errorMessage(e: unknown): string {
  return ApiError.from(e).message;
}
