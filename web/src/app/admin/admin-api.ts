import { Injectable, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Address, CustomerType, EnquiryType, OrderDetail, OrderStatus, PaymentMethod, PaymentStatus } from '../core/models';

// Shapes returned by /api/admin (snake_case, like the database).

export interface Dashboard {
  pending_orders: number;
  today_deliveries: number;
  out_for_delivery: number;
  needs_refund: number;
  new_enquiries: number;
  low_stock: number;
  today_sales: number;
}

export interface AdminOrderRow {
  id: string;
  order_no: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  total: number;
  delivery_date: string;
  slot_label: string;
  created_at: string;
  needs_refund: boolean;
  customer_name: string | null;
  customer_phone: string | null;
  pincode: string | null;
}

export interface AdminOrder extends OrderDetail {
  user_id: string;
  admin_notes: string | null;
  needs_refund: boolean;
  customer: { id: string; full_name: string | null; phone: string | null; email: string | null; customer_type: CustomerType } | null;
}

export type Role = 'customer' | 'staff' | 'admin';

export interface CustomerRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: Role;
  customer_type: CustomerType;
  is_active: boolean;
  created_at: string;
  orders_count: number;
  cans_with_deposit: number;
}

export interface DepositEntry {
  id: number;
  order_id: string | null;
  entry_type: 'collected' | 'refunded' | 'adjustment';
  cans_delta: number;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface CustomerDetail extends CustomerRow {
  addresses: Address[];
  orders: { id: string; order_no: string; status: OrderStatus; payment_status: PaymentStatus; total: number; delivery_date: string; created_at: string }[];
  deposit_ledger: DepositEntry[];
}

export type EnquiryStatus = 'new' | 'in_progress' | 'closed';

export interface Enquiry {
  id: string;
  enquiry_type: EnquiryType;
  status: EnquiryStatus;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  quantity_note: string | null;
  preferred_date: string | null;
  message: string;
  admin_notes: string | null;
  created_at: string;
}

export interface SalesReport {
  from: string;
  to: string;
  totals: { orders: number; delivered: number; cancelled: number; open: number; sales: number; collected: number; deposits: number; cod_outstanding: number; needs_refund: number };
  by_day: { day: string; orders: number; sales: number }[];
  by_product: { product_id: number | null; name: string; quantity: number; sales: number }[];
  by_status: Partial<Record<OrderStatus, number>>;
}

export interface AdminProduct {
  id: number;
  category_id: number;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  unit_label: string;
  price: number;
  is_sample_price: boolean;
  is_returnable_can: boolean;
  /** Returnable cans in one unit (5 for a pack of five). */
  cans_per_unit: number;
  /** Deposit for one can. */
  deposit_amount: number;
  track_stock: boolean;
  stock_qty: number;
  min_order_qty: number;
  max_order_qty: number;
  image_path: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}
export type ProductInput = Omit<AdminProduct, 'id' | 'stock_qty' | 'image_url'>;

export interface StockEntry {
  id: number;
  qty_delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  order_no: string | null;
  created_by_name: string | null;
}

export interface AdminCategory {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}
export type CategoryInput = Omit<AdminCategory, 'id'>;

export interface Zone {
  id: number;
  name: string;
  pincodes: string[];
  delivery_charge: number;
  free_delivery_min: number | null;
  min_order_amount: number;
  is_active: boolean;
}
export type ZoneInput = Omit<Zone, 'id'>;

export interface AdminSlot {
  id: number;
  label: string;
  start_time: string;
  end_time: string;
  capacity: number;
  cutoff_minutes: number;
  days_of_week: number[];
  sort_order: number;
  is_active: boolean;
}
export type SlotInput = Omit<AdminSlot, 'id'>;

export interface BusinessSettings {
  deposit_enabled: boolean;
  cod_enabled: boolean;
  online_payment_enabled: boolean;
  max_advance_days: number;
  closed_dates: string[];
  unpaid_order_expiry_minutes: number;
  timezone: string;
}

export interface AdminTestimonial {
  id: number;
  author_name: string;
  author_location: string | null;
  content: string;
  rating: number | null;
  is_sample: boolean;
  is_published: boolean;
  sort_order: number;
}
export type TestimonialInput = Omit<AdminTestimonial, 'id'>;

type Query = Record<string, string | number | boolean | null | undefined>;

/** Staff and admin endpoints. The API checks the role on every call; the menu only hides links. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiService);
  private readonly base = '/admin';

  dashboard = () => this.api.get<Dashboard>(this.base + '/dashboard');

  // Orders
  orders = (q: Query) => this.api.get<AdminOrderRow[]>(this.base + '/orders', q);
  order = (id: string) => this.api.get<AdminOrder>(`${this.base}/orders/${id}`);
  setStatus = (id: string, body: { status: OrderStatus; note?: string | null; cans_delivered?: number | null; empties_collected?: number | null }) =>
    this.api.post<AdminOrder>(`${this.base}/orders/${id}/status`, body);
  markCodPaid = (id: string) => this.api.post<AdminOrder>(`${this.base}/orders/${id}/cod-paid`);
  setNotes = (id: string, notes: string | null) => this.api.put<AdminOrder>(`${this.base}/orders/${id}/notes`, { notes });
  markRefunded = (id: string, note: string | null) => this.api.post<AdminOrder>(`${this.base}/orders/${id}/refunded`, { note });

  // Customers
  customers = (q: Query) => this.api.get<CustomerRow[]>(this.base + '/customers', q);
  customer = (id: string) => this.api.get<CustomerDetail>(`${this.base}/customers/${id}`);
  setRole = (id: string, role: Role, is_active: boolean) => this.api.put<CustomerDetail>(`${this.base}/customers/${id}/role`, { role, is_active });
  recordDeposit = (id: string, body: { entry_type: 'refunded' | 'adjustment'; cans: number; amount: number; note: string | null }) =>
    this.api.post<CustomerDetail>(`${this.base}/customers/${id}/deposits`, body);

  // Enquiries
  enquiries = (q: Query) => this.api.get<Enquiry[]>(this.base + '/enquiries', q);
  updateEnquiry = (id: string, status: EnquiryStatus, admin_notes: string | null) => this.api.put<Enquiry>(`${this.base}/enquiries/${id}`, { status, admin_notes });

  // Reports
  sales = (from: string, to: string) => this.api.get<SalesReport>(this.base + '/reports/sales', { from, to });

  // Catalog (admin only)
  products = () => this.api.get<AdminProduct[]>(this.base + '/products');
  saveProduct = (id: number | null, p: ProductInput) =>
    id ? this.api.put<AdminProduct>(`${this.base}/products/${id}`, p) : this.api.post<AdminProduct>(this.base + '/products', p);
  adjustStock = (id: number, delta: number, reason: 'restock' | 'adjustment' | 'damaged', note: string | null) =>
    this.api.post<{ stock_qty: number }>(`${this.base}/products/${id}/stock`, { delta, reason, note });
  stockHistory = (id: number) => this.api.get<StockEntry[]>(`${this.base}/products/${id}/stock`);
  categories = () => this.api.get<AdminCategory[]>(this.base + '/categories');
  saveCategory = (id: number | null, c: CategoryInput) =>
    id ? this.api.put<AdminCategory>(`${this.base}/categories/${id}`, c) : this.api.post<AdminCategory>(this.base + '/categories', c);

  // Delivery and settings (admin only)
  zones = () => this.api.get<Zone[]>(this.base + '/zones');
  saveZone = (id: number | null, z: ZoneInput) => (id ? this.api.put<Zone>(`${this.base}/zones/${id}`, z) : this.api.post<Zone>(this.base + '/zones', z));
  slots = () => this.api.get<AdminSlot[]>(this.base + '/slots');
  saveSlot = (id: number | null, s: SlotInput) => (id ? this.api.put<AdminSlot>(`${this.base}/slots/${id}`, s) : this.api.post<AdminSlot>(this.base + '/slots', s));
  settings = () => this.api.get<BusinessSettings>(this.base + '/settings');
  saveSettings = (s: Omit<BusinessSettings, 'timezone'>) => this.api.put<BusinessSettings>(this.base + '/settings', s);

  // Reviews (admin only)
  testimonials = () => this.api.get<AdminTestimonial[]>(this.base + '/testimonials');
  saveTestimonial = (id: number | null, t: TestimonialInput) =>
    id ? this.api.put<AdminTestimonial>(`${this.base}/testimonials/${id}`, t) : this.api.post<AdminTestimonial>(this.base + '/testimonials', t);
  deleteTestimonial = (id: number) => this.api.delete<{ ok: boolean }>(`${this.base}/testimonials/${id}`);
}
