import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { SiteLayout } from './layout/site-layout';

const t = (page: string) => `${page} | AquaPure Water`;

export const routes: Routes = [
  {
    path: '',
    component: SiteLayout,
    children: [
      { path: '', title: 'AquaPure Water | Water can delivery and bottled water', loadComponent: () => import('./pages/home').then((m) => m.Home) },
      { path: 'products', title: t('Products'), loadComponent: () => import('./pages/products').then((m) => m.Products) },
      { path: 'products/:slug', title: t('Product'), loadComponent: () => import('./pages/product-detail').then((m) => m.ProductDetail) },
      { path: 'cart', title: t('Your cart'), loadComponent: () => import('./pages/cart').then((m) => m.Cart) },
      { path: 'checkout', title: t('Checkout'), loadComponent: () => import('./pages/not-found').then((m) => m.CheckoutSoon) },
      { path: 'services', title: t('Services'), loadComponent: () => import('./pages/services').then((m) => m.Services) },
      { path: 'delivery', title: t('Delivery areas'), loadComponent: () => import('./pages/delivery').then((m) => m.Delivery) },
      { path: 'about', title: t('About us'), loadComponent: () => import('./pages/about').then((m) => m.About) },
      { path: 'faq', title: t('FAQ'), loadComponent: () => import('./pages/faq').then((m) => m.Faq) },
      { path: 'contact', title: t('Contact us'), loadComponent: () => import('./pages/contact').then((m) => m.Contact) },
      { path: 'login', title: t('Sign in'), canActivate: [guestGuard], loadComponent: () => import('./pages/auth-pages').then((m) => m.Login) },
      { path: 'register', title: t('Create account'), canActivate: [guestGuard], loadComponent: () => import('./pages/auth-pages').then((m) => m.Register) },
      { path: 'forgot-password', title: t('Reset password'), loadComponent: () => import('./pages/auth-pages').then((m) => m.ForgotPassword) },
      { path: 'reset-password', title: t('New password'), loadComponent: () => import('./pages/auth-pages').then((m) => m.ResetPassword) },
      { path: 'account', title: t('My account'), canActivate: [authGuard], loadComponent: () => import('./pages/account').then((m) => m.Account) },
      { path: '**', title: t('Page not found'), loadComponent: () => import('./pages/not-found').then((m) => m.NotFound) },
    ],
  },
];
