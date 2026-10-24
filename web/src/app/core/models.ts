// Shapes returned by the AquaPure API (snake_case, like the database).

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  short_description: string | null;
  description?: string | null;
  unit_label: string;
  price: number;
  is_sample_price: boolean;
  is_returnable_can: boolean;
  deposit_amount: number;
  min_order_qty: number;
  max_order_qty: number;
  image_path: string | null;
  image_url: string | null;
  in_stock: boolean;
  category_id: number;
  category_slug: string;
  category_name?: string;
}

export interface Catalog {
  categories: Category[];
  products: Product[];
}

export interface PublicSettings {
  deposit_enabled: boolean;
  cod_enabled: boolean;
  online_payment_enabled: boolean;
  max_advance_days: number;
  closed_dates: string[];
  timezone: string;
  today: string;
  razorpay_key_id: string | null;
}

export interface PincodeCheck {
  pincode: string;
  served: boolean;
  zone_name?: string;
  delivery_charge?: number;
  free_delivery_min?: number | null;
  min_order_amount?: number;
}

export interface Slot {
  slot_id: number;
  label: string;
  start_time: string;
  end_time: string;
  remaining: number;
  is_available: boolean;
  reason: string | null;
}

export interface Testimonial {
  id: number;
  author_name: string;
  author_location: string | null;
  content: string;
  rating: number | null;
  is_sample: boolean;
}

export type EnquiryType = 'general' | 'bulk_order' | 'monthly_supply' | 'office_supply' | 'event';

export interface EnquiryRequest {
  enquiry_type: EnquiryType;
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  quantity_note?: string | null;
  preferred_date?: string | null;
  message: string;
  website?: string; // spam trap, must stay empty
}

export type CustomerType = 'home' | 'office' | 'shop' | 'hotel' | 'other';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: 'customer' | 'staff' | 'admin';
  customer_type: CustomerType;
  cans_with_deposit: number;
  deposit_balance: number;
}

export interface Address {
  id: string;
  label: string;
  contact_name: string;
  contact_phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  pincode: string;
  is_default: boolean;
}

export type AddressInput = Omit<Address, 'id'>;

// ---------- Orders ----------
export type OrderStatus = 'pending' | 'confirmed' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cod' | 'razorpay';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';

export interface QuoteLine {
  product_id: number;
  product_name: string;
  unit_label: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  deposit_qty: number;
  deposit_total: number;
}

/** Prices worked out by the server for a cart and address. */
export interface Quote {
  zone_name: string;
  min_order_amount: number;
  free_delivery_min: number | null;
  lines: QuoteLine[];
  subtotal: number;
  delivery_charge: number;
  deposit_total: number;
  total: number;
}

export interface OrderItemInput {
  product_id: number;
  quantity: number;
}

export interface PlaceOrderRequest {
  address_id: string;
  items: OrderItemInput[];
  delivery_date: string;
  slot_id: number;
  payment_method: PaymentMethod;
  notes: string | null;
  idempotency_key: string;
}

export interface OrderSummary {
  id: string;
  order_no: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  total: number;
  delivery_date: string;
  slot_label: string;
  created_at: string;
  item_count: number;
}

export interface OrderDetail extends Omit<OrderSummary, 'item_count'> {
  delivery_address: Omit<AddressInput, 'is_default'>;
  zone_id: number | null;
  slot_id: number | null;
  subtotal: number;
  delivery_charge: number;
  deposit_total: number;
  customer_notes: string | null;
  cancel_reason: string | null;
  cans_delivered: number | null;
  empties_collected: number | null;
  confirmed_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  items: (QuoteLine & { product_id: number | null })[];
  history: { from_status: OrderStatus | null; to_status: OrderStatus; note: string | null; created_at: string }[];
  payments: {
    provider: string;
    status: string;
    method: string | null;
    amount: number;
    razorpay_payment_id: string | null;
    error_description: string | null;
    created_at: string;
    captured_at: string | null;
  }[];
}

// ---------- Razorpay ----------
export interface RazorpayCheckout {
  key_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  currency: string;
  order_id: string;
  order_no: string;
  prefill: { name: string | null; email: string | null; contact: string | null };
}

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
