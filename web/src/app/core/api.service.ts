import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from './app-config';
import { Catalog, EnquiryRequest, PincodeCheck, Product, PublicSettings, Slot, Testimonial } from './models';

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
