import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Address, BookRequest, Customer, CustomerType, Dashboard, Driver, Invoice, Order, PaymentMode, Product, Profile,
  Report, Role, Staff, TokenResponse,
} from './models';

/** Typed calls to the WBMS API. Every method returns a Promise; errors are HttpErrorResponse (see errorMessage). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  private get<T>(url: string, params?: Record<string, string | number | boolean | null | undefined>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return firstValueFrom(this.http.get<T>(url, { params: p }));
  }
  private post<T>(url: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(url, body)); }
  private put<T>(url: string, body: unknown) { return firstValueFrom(this.http.put<T>(url, body)); }

  // Sign-in
  register(r: { name: string; phone: string; type: CustomerType; addressLine: string; area: string }) {
    return this.post<void>('api/auth/register', r);
  }
  requestOtp(phone: string) { return this.post<void>('api/auth/request-otp', { phone }); }
  verifyOtp(phone: string, otp: string) { return this.post<TokenResponse>('api/auth/verify', { phone, otp }); }
  passwordLogin(phone: string, password: string) { return this.post<TokenResponse>('api/auth/password', { phone, password }); }

  // Shared
  me() { return this.get<Profile>('api/me'); }
  products(all = false) { return this.get<Product[]>('api/products', { all: all || null }); }
  orders(filter: { status?: string; customerId?: number; driverId?: number; date?: string } = {}) {
    return this.get<Order[]>('api/orders', filter);
  }
  order(id: number) { return this.get<Order>(`api/orders/${id}`); }
  invoices(customerId: number) { return this.get<Invoice[]>(`api/customers/${customerId}/invoices`); }

  /** Downloads the invoice PDF and saves it in the browser. */
  async downloadInvoice(invoiceId: number, invoiceNo: string) {
    const blob = await firstValueFrom(this.http.get(`api/invoices/${invoiceId}/pdf`, { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceNo}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // Customer
  addAddress(a: { line: string; area: string; isDefault: boolean }) { return this.post<Address>('api/me/addresses', a); }
  book(r: BookRequest) { return this.post<Order>('api/orders', r); }
  cancel(id: number) { return this.post<Order>(`api/orders/${id}/cancel`); }
  paymentLink(id: number) { return this.post<{ url: string }>(`api/orders/${id}/payment-link`); }

  // Driver
  start(id: number) { return this.post<Order>(`api/orders/${id}/start`); }
  resendOtp(id: number) { return this.post<void>(`api/orders/${id}/resend-otp`); }
  sendLocation(id: number, lat: number, lng: number) { return this.post<void>(`api/orders/${id}/location`, { lat, lng }); }
  complete(id: number, r: { otp: string; fullCansDelivered: number; emptyCansCollected: number; cashCollected: number }) {
    return this.post<Order>(`api/orders/${id}/complete`, r);
  }

  // Staff
  confirm(id: number) { return this.post<Order>(`api/orders/${id}/confirm`); }
  assign(id: number, driverId: number) { return this.post<Order>(`api/orders/${id}/assign`, { driverId }); }
  recordPayment(id: number, amount: number, reference: string) {
    return this.post<Order>(`api/orders/${id}/payment`, { amount, reference });
  }
  customers() { return this.get<Customer[]>('api/customers'); }
  addCustomer(r: { name: string; phone: string; type: CustomerType; creditLimit: number; addressLine: string; area: string }) {
    return this.post<Customer>('api/customers', r);
  }
  updateCustomer(id: number, r: { name: string; type: CustomerType; creditLimit: number; isActive: boolean }) {
    return this.put<Customer>(`api/customers/${id}`, r);
  }
  settle(id: number, amount: number, mode: PaymentMode, reference: string) {
    return this.post<Customer>(`api/customers/${id}/settle`, { amount, mode, reference });
  }
  drivers() { return this.get<Driver[]>('api/drivers'); }
  addDriver(r: { name: string; phone: string; licenseNo: string; vehicleNo: string; vehicleCapacity: number }) {
    return this.post<Driver>('api/drivers', r);
  }
  setDriverActive(id: number, active: boolean) { return this.post<Driver>(`api/drivers/${id}/active`, { active }); }
  addProduct(r: { name: string; price: number; isReturnable: boolean }) { return this.post<Product>('api/products', r); }
  updateProduct(id: number, r: { price?: number; isActive?: boolean }) { return this.put<Product>(`api/products/${id}`, r); }
  fillStock(id: number, qty: number) { return this.post<Product>(`api/products/${id}/fill`, { qty }); }
  dashboard() { return this.get<Dashboard>('api/admin/dashboard'); }
  report(from: string, to: string) { return this.get<Report>('api/admin/reports', { from, to }); }
  staff() { return this.get<Staff[]>('api/admin/staff'); }
  addStaff(r: { name: string; phone: string; role: Role; password: string }) { return this.post<Staff>('api/admin/staff', r); }
  setStaffActive(id: number, active: boolean) { return this.post<Staff>(`api/admin/staff/${id}/active`, { active }); }
  changePassword(current: string, next: string) { return this.post<void>('api/me/password', { current, new: next }); }
}
