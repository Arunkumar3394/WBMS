import { Component, Injectable, computed, effect, inject, signal } from '@angular/core';
import { CanActivateFn, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Profile } from '../core/models';
import { Logo } from '../shared/ui';

/** The signed-in staff member's profile, loaded once per sign-in. */
@Injectable({ providedIn: 'root' })
export class AdminContext {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly profile = signal<Profile | null>(null);
  readonly isAdmin = computed(() => this.profile()?.role === 'admin');
  private loading?: Promise<Profile | null>;

  constructor() {
    // Forget the profile when someone signs out or another user signs in.
    effect(() => {
      const id = this.auth.user()?.id;
      if (id !== this.profile()?.id) {
        this.profile.set(null);
        this.loading = undefined;
      }
    });
  }

  load(): Promise<Profile | null> {
    if (this.profile()) return Promise.resolve(this.profile());
    return (this.loading ??= this.api.me().then(
      (p) => {
        this.profile.set(p);
        return p;
      },
      () => {
        this.loading = undefined;
        return null;
      },
    ));
  }
}

/**
 * Staff and admins only. This only decides which pages to show: every admin API call is
 * checked again by the API and the database.
 */
export const staffGuard: CanActivateFn = async (_route, state) => {
  // inject() only works before the first await.
  const auth = inject(AuthService);
  const router = inject(Router);
  const ctx = inject(AdminContext);
  await auth.ready;
  if (!auth.signedIn()) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  const p = await ctx.load();
  return p && (p.role === 'staff' || p.role === 'admin') ? true : router.parseUrl('/account');
};

export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const p = await inject(AdminContext).load();
  return p?.role === 'admin' ? true : router.parseUrl('/admin');
};

interface NavItem {
  path: string;
  label: string;
  adminOnly?: boolean;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { path: '/admin', label: 'Dashboard', exact: true },
  { path: '/admin/orders', label: 'Orders' },
  { path: '/admin/customers', label: 'Customers' },
  { path: '/admin/enquiries', label: 'Enquiries' },
  { path: '/admin/reports', label: 'Reports' },
  { path: '/admin/products', label: 'Products', adminOnly: true },
  { path: '/admin/categories', label: 'Categories', adminOnly: true },
  { path: '/admin/delivery', label: 'Delivery', adminOnly: true },
  { path: '/admin/settings', label: 'Settings', adminOnly: true },
  { path: '/admin/reviews', label: 'Reviews', adminOnly: true },
];

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo],
  template: `
    <a href="#admin-main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">Skip to content</a>
    <header class="border-b border-slate-200 bg-white">
      <div class="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div class="flex items-center gap-3">
          <app-logo />
          <span class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{{ ctx.isAdmin() ? 'Admin' : 'Staff' }}</span>
        </div>
        <div class="flex items-center gap-4 text-sm">
          <span class="hidden text-slate-500 sm:inline">{{ ctx.profile()?.full_name || ctx.profile()?.email }}</span>
          <a routerLink="/" class="font-medium text-brand-700 hover:underline">View site</a>
          <button type="button" class="font-medium text-slate-600 hover:underline" (click)="signOut()">Sign out</button>
        </div>
      </div>
      <nav class="overflow-x-auto border-t border-slate-100 lg:hidden" aria-label="Admin">
        <ul class="flex gap-1 px-2 py-2">
          @for (n of nav(); track n.path) {
            <li>
              <a [routerLink]="n.path" routerLinkActive="bg-brand-600 text-white" [routerLinkActiveOptions]="{ exact: !!n.exact }"
                 ariaCurrentWhenActive="page" class="block rounded-full px-3 py-1.5 text-sm whitespace-nowrap text-slate-700">{{ n.label }}</a>
            </li>
          }
        </ul>
      </nav>
    </header>
    <div class="flex min-h-[calc(100vh-4rem)] bg-slate-50">
      <nav class="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 lg:block" aria-label="Admin">
        <ul class="space-y-1">
          @for (n of nav(); track n.path) {
            <li>
              <a [routerLink]="n.path" routerLinkActive="bg-brand-50 text-brand-800 font-semibold" [routerLinkActiveOptions]="{ exact: !!n.exact }"
                 ariaCurrentWhenActive="page" class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{{ n.label }}</a>
            </li>
          }
        </ul>
      </nav>
      <main id="admin-main" class="min-w-0 flex-1 p-4 sm:p-6 lg:p-8" tabindex="-1">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AdminLayout {
  protected readonly ctx = inject(AdminContext);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly nav = computed(() => NAV.filter((n) => !n.adminOnly || this.ctx.isAdmin()));

  protected async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
