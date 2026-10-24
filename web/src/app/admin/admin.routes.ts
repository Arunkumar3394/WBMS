import { Routes } from '@angular/router';
import { AdminLayout, adminGuard, staffGuard } from './admin-layout';

const t = (page: string) => `${page} | AquaPure admin`;

/** Mounted at /admin. Staff and admins only; admin-only pages add adminGuard. The API checks roles again. */
export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminLayout,
    canActivate: [staffGuard],
    children: [
      { path: '', title: t('Dashboard'), loadComponent: () => import('./dashboard').then((m) => m.AdminDashboard) },
      { path: 'orders', title: t('Orders'), loadComponent: () => import('./orders').then((m) => m.AdminOrders) },
      { path: 'orders/:id', title: t('Order'), loadComponent: () => import('./orders').then((m) => m.AdminOrderDetail) },
      { path: 'customers', title: t('Customers'), loadComponent: () => import('./customers').then((m) => m.AdminCustomers) },
      { path: 'customers/:id', title: t('Customer'), loadComponent: () => import('./customers').then((m) => m.AdminCustomerDetail) },
      { path: 'enquiries', title: t('Enquiries'), loadComponent: () => import('./enquiries').then((m) => m.AdminEnquiries) },
      { path: 'reports', title: t('Reports'), loadComponent: () => import('./reports').then((m) => m.AdminReports) },
      { path: 'products', title: t('Products'), canActivate: [adminGuard], loadComponent: () => import('./products').then((m) => m.AdminProducts) },
      { path: 'categories', title: t('Categories'), canActivate: [adminGuard], loadComponent: () => import('./setup').then((m) => m.AdminCategories) },
      { path: 'delivery', title: t('Delivery'), canActivate: [adminGuard], loadComponent: () => import('./setup').then((m) => m.AdminDelivery) },
      { path: 'settings', title: t('Settings'), canActivate: [adminGuard], loadComponent: () => import('./setup').then((m) => m.AdminSettings) },
      { path: 'reviews', title: t('Reviews'), canActivate: [adminGuard], loadComponent: () => import('./setup').then((m) => m.AdminReviews) },
      { path: '**', redirectTo: '' },
    ],
  },
];
