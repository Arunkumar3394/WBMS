import { Routes } from '@angular/router';
import { adminGuard, customerGuard, staffGuard } from './shared/guards';

export const routes: Routes = [
  { path: 'admin/login', title: 'Staff sign-in · WBMS', loadComponent: () => import('./admin/admin-login').then((m) => m.AdminLogin) },
  {
    path: 'admin',
    canActivate: [staffGuard],
    loadComponent: () => import('./admin/admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', title: 'Dashboard · WBMS', loadComponent: () => import('./admin/dashboard').then((m) => m.Dashboard) },
      { path: 'orders', title: 'Orders · WBMS', loadComponent: () => import('./admin/admin-orders').then((m) => m.AdminOrders) },
      { path: 'customers', title: 'Customers · WBMS', loadComponent: () => import('./admin/admin-customers').then((m) => m.AdminCustomers) },
      { path: 'drivers', title: 'Drivers · WBMS', loadComponent: () => import('./admin/admin-drivers').then((m) => m.AdminDrivers) },
      { path: 'products', title: 'Products · WBMS', loadComponent: () => import('./admin/admin-products').then((m) => m.AdminProducts) },
      { path: 'reports', title: 'Reports · WBMS', loadComponent: () => import('./admin/admin-reports').then((m) => m.AdminReports) },
      { path: 'staff', title: 'Staff · WBMS', canActivate: [adminGuard], loadComponent: () => import('./admin/admin-staff').then((m) => m.AdminStaff) },
      { path: 'account', title: 'Account · WBMS', loadComponent: () => import('./admin/admin-account').then((m) => m.AdminAccount) },
    ],
  },
  {
    path: '',
    loadComponent: () => import('./customer/customer-shell').then((m) => m.CustomerShell),
    children: [
      { path: 'login', title: 'Sign in · WBMS Water', loadComponent: () => import('./customer/login').then((m) => m.Login) },
      { path: 'register', title: 'Create account · WBMS Water', loadComponent: () => import('./customer/register').then((m) => m.Register) },
      { path: '', title: 'Book water · WBMS Water', canActivate: [customerGuard], loadComponent: () => import('./customer/home').then((m) => m.Home) },
      { path: 'orders', title: 'Your orders · WBMS Water', canActivate: [customerGuard], loadComponent: () => import('./customer/orders').then((m) => m.Orders) },
      { path: 'orders/:id', title: 'Order · WBMS Water', canActivate: [customerGuard], loadComponent: () => import('./customer/order-detail').then((m) => m.OrderDetail) },
      { path: 'account', title: 'Account · WBMS Water', canActivate: [customerGuard], loadComponent: () => import('./customer/account').then((m) => m.Account) },
    ],
  },
  { path: '**', redirectTo: '' },
];
