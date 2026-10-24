import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { BUSINESS, telLink, whatsappLink } from '../core/business';
import { AuthService } from '../core/auth.service';
import { CartService } from '../core/cart.service';
import { Logo } from '../shared/ui';

const NAV = [
  { path: '/products', label: 'Products' },
  { path: '/services', label: 'Services' },
  { path: '/delivery', label: 'Delivery' },
  { path: '/about', label: 'About us' },
  { path: '/faq', label: 'FAQ' },
  { path: '/contact', label: 'Contact' },
];

@Component({
  selector: 'app-site-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo],
  template: `
    <a href="#main" class="sr-only z-50 rounded bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>

    <header class="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div class="container-page flex h-16 items-center justify-between gap-4">
        <app-logo />
        <nav class="hidden items-center gap-1 lg:flex" aria-label="Main">
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="text-brand-700 bg-brand-50" ariaCurrentWhenActive="page"
               class="rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:text-brand-700">{{ item.label }}</a>
          }
        </nav>
        <div class="flex items-center gap-2">
          @if (auth.signedIn()) {
            <a routerLink="/account" class="hidden rounded-full px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 sm:inline-flex">My account</a>
          } @else {
            <a routerLink="/login" class="hidden rounded-full px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 sm:inline-flex">Sign in</a>
          }
          <a routerLink="/cart" class="relative rounded-full p-2 text-slate-700 hover:bg-brand-50 hover:text-brand-700"
             [attr.aria-label]="'Cart, ' + cart.count() + (cart.count() === 1 ? ' item' : ' items')">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01" />
            </svg>
            @if (cart.count() > 0) {
              <span class="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-aqua-500 px-1 text-xs font-bold text-white">{{ cart.count() }}</span>
            }
          </a>
          <a routerLink="/products" class="btn-primary hidden sm:inline-flex">Order water</a>
          <button type="button" class="rounded-lg p-2 text-slate-700 lg:hidden" (click)="menuOpen.set(!menuOpen())"
                  [attr.aria-expanded]="menuOpen()" aria-controls="mobile-menu" [attr.aria-label]="menuOpen() ? 'Close menu' : 'Open menu'">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              @if (menuOpen()) {
                <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              } @else {
                <path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
              }
            </svg>
          </button>
        </div>
      </div>
      @if (menuOpen()) {
        <nav id="mobile-menu" class="border-t border-slate-200 bg-white lg:hidden" aria-label="Main">
          <div class="container-page flex flex-col py-2">
            @for (item of nav; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="text-brand-700" ariaCurrentWhenActive="page"
                 class="rounded-lg px-2 py-3 font-medium text-slate-700">{{ item.label }}</a>
            }
            <a [routerLink]="auth.signedIn() ? '/account' : '/login'" class="rounded-lg px-2 py-3 font-medium text-slate-700">{{ auth.signedIn() ? 'My account' : 'Sign in' }}</a>
            <a routerLink="/products" class="btn-primary my-2">Order water</a>
          </div>
        </nav>
      }
    </header>

    <main id="main" tabindex="-1" class="min-h-[60vh] focus:outline-none">
      <router-outlet />
    </main>

    <footer class="mt-16 bg-brand-900 text-brand-100">
      <div class="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <app-logo [light]="true" />
          <p class="mt-3 text-sm text-brand-200">{{ business.tagline }} 20-litre cans and packaged drinking water for homes, offices and businesses.</p>
        </div>
        <div>
          <h2 class="text-sm font-semibold text-white">Shop</h2>
          <ul class="mt-3 space-y-2 text-sm">
            <li><a routerLink="/products" [queryParams]="{ category: 'water-cans' }" class="hover:text-white">20-litre water cans</a></li>
            <li><a routerLink="/products" [queryParams]="{ category: 'water-bottles' }" class="hover:text-white">Bottled water</a></li>
            <li><a routerLink="/contact" [queryParams]="{ type: 'bulk_order' }" class="hover:text-white">Bulk &amp; event orders</a></li>
            <li><a routerLink="/contact" [queryParams]="{ type: 'monthly_supply' }" class="hover:text-white">Monthly supply</a></li>
          </ul>
        </div>
        <div>
          <h2 class="text-sm font-semibold text-white">Company</h2>
          <ul class="mt-3 space-y-2 text-sm">
            <li><a routerLink="/about" class="hover:text-white">About us</a></li>
            <li><a routerLink="/services" class="hover:text-white">Services</a></li>
            <li><a routerLink="/delivery" class="hover:text-white">Delivery areas</a></li>
            <li><a routerLink="/faq" class="hover:text-white">FAQ</a></li>
          </ul>
        </div>
        <div>
          <h2 class="text-sm font-semibold text-white">Contact</h2>
          <ul class="mt-3 space-y-2 text-sm">
            @if (business.phone) {
              <li><a [href]="tel(business.phone)" class="hover:text-white">{{ business.phone }}</a></li>
            }
            @if (business.email) {
              <li><a [href]="'mailto:' + business.email" class="hover:text-white">{{ business.email }}</a></li>
            }
            @for (line of business.address; track $index) {
              <li>{{ line }}</li>
            }
            <li><a routerLink="/contact" class="hover:text-white">Send us a message →</a></li>
          </ul>
        </div>
      </div>
      <div class="border-t border-white/10">
        <p class="container-page py-5 text-xs text-brand-300">© {{ year }} {{ business.name }}. All rights reserved.</p>
      </div>
    </footer>

    @if (whatsapp) {
      <a [href]="whatsapp" target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp"
         class="fixed right-4 bottom-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#1f8f4e] text-white shadow-lg hover:bg-[#187a41]">
        <svg viewBox="0 0 24 24" class="h-7 w-7" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/>
        </svg>
      </a>
    }
  `,
})
export class SiteLayout {
  protected readonly cart = inject(CartService);
  protected readonly auth = inject(AuthService);
  protected readonly nav = NAV;
  protected readonly business = BUSINESS;
  protected readonly whatsapp = whatsappLink();
  protected readonly tel = telLink;
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);

  constructor() {
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
  }
}
