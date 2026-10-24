// Mirrors of the WBMS API's JSON. Enums travel as strings.
export type Role = 'Admin' | 'Staff' | 'Driver' | 'Customer';
export type CustomerType = 'Home' | 'Shop' | 'Office';
export type PaymentMode = 'Cash' | 'Credit' | 'Upi' | 'Card' | 'Razorpay';
export type OrderStatus =
  | 'Placed' | 'PaymentPending' | 'Paid' | 'OnCredit' | 'Confirmed' | 'Assigned'
  | 'OutForDelivery' | 'Delivered' | 'Completed' | 'Cancelled' | 'Failed';
export const ORDER_STATUSES: OrderStatus[] = [
  'Placed', 'PaymentPending', 'Paid', 'OnCredit', 'Confirmed', 'Assigned',
  'OutForDelivery', 'Delivered', 'Completed', 'Cancelled', 'Failed',
];

export interface SignedInUser {
  userId: number; name: string; phone: string; role: Role; customerId: number | null; driverId: number | null;
}
export interface TokenResponse { token: string; user: SignedInUser; }

export interface Address {
  id: number; customerId: number; line: string; area: string; lat: number | null; lng: number | null; isDefault: boolean;
}
export interface Profile {
  userId: number; customerId: number | null; name: string; phone: string; role: Role;
  balance: number | null; creditLimit: number | null; cansHeld: number | null; addresses: Address[];
}
export interface Product {
  id: number; name: string; price: number; isReturnable: boolean; stockFull: number; isActive: boolean;
}
export interface OrderItem { productId: number; product: string; qty: number; unitPrice: number; }
export interface Order {
  id: number; orderNo: string; customerId: number; customerName: string; customerPhone: string; address: string;
  addressLat: number | null; addressLng: number | null; status: OrderStatus; paymentMode: PaymentMode; total: number;
  slotDate: string; driverId: number | null; driverName: string | null; driverPhone: string | null; items: OrderItem[];
  driverLat: number | null; driverLng: number | null; driverLocationAt: string | null;
  invoiceNo: string | null; invoiceId: number | null; notes: string | null; createdAt: string;
}
export interface Invoice {
  id: number; orderId: number; invoiceNo: string; customerId: number; amount: number; tax: number; amountPaid: number;
  status: 'Unpaid' | 'PartiallyPaid' | 'Paid'; issuedAt: string;
}
export interface AppUser { id: number; name: string; phone: string; role: Role; isActive: boolean; createdAt: string; }
export interface Customer {
  id: number; userId: number; user: AppUser; type: CustomerType; creditLimit: number; balance: number;
  depositPaid: number; cansHeld: number; addresses: Address[];
}
export interface Driver {
  id: number; userId: number; user: AppUser; licenseNo: string | null; vehicleNo: string | null; vehicleCapacity: number;
}
export interface Staff { id: number; name: string; phone: string; role: Role; isActive: boolean; }
export interface Dashboard {
  toConfirm: number; toAssign: number; outForDelivery: number; deliveredToday: number;
  salesToday: number; dues: number; cansOut: number; fullStock: number;
}
export interface Report {
  from: string; to: string; sales: number; collected: number; delivered: number; cancelled: number;
  cansOut: number; cansIn: number; duesNow: number; cansWithCustomers: number;
  byMode: { mode: PaymentMode; count: number; amount: number }[];
  byDriver: { name: string; deliveries: number; cansOut: number; cansIn: number; cash: number }[];
  daily: { day: string; count: number; amount: number }[];
  topDues: { customerId: number; name: string; phone: string; due: number; cans: number }[];
}
export interface BookRequest {
  addressId: number; paymentMode: PaymentMode; slotDate: string;
  items: { productId: number; qty: number }[]; notes: string | null; customerId?: number;
}
