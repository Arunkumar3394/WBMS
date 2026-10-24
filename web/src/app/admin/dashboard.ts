import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, Dashboard } from './admin-api';
import { AdminContext } from './admin-layout';
import { AdminTitle } from './admin-ui';

@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterLink, RupeesPipe, AdminTitle, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Dashboard" [subtitle]="'Welcome, ' + (ctx.profile()?.full_name || 'team') + '.'">
      <button type="button" class="btn-secondary" (click)="load()">Refresh</button>
    </app-admin-title>
    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error [message]="error()!" [retry]="load" />
    } @else if (d(); as d) {
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <a routerLink="/admin/orders" [queryParams]="{ status: 'pending' }" class="card p-5 hover:border-brand-300">
          <p class="text-sm text-slate-500">New orders to confirm</p>
          <p class="mt-1 text-3xl font-semibold text-brand-900">{{ d.pending_orders }}</p>
        </a>
        <a routerLink="/admin/orders" [queryParams]="{ date: today }" class="card p-5 hover:border-brand-300">
          <p class="text-sm text-slate-500">Deliveries today</p>
          <p class="mt-1 text-3xl font-semibold text-brand-900">{{ d.today_deliveries }}</p>
        </a>
        <a routerLink="/admin/orders" [queryParams]="{ status: 'out_for_delivery' }" class="card p-5 hover:border-brand-300">
          <p class="text-sm text-slate-500">Out for delivery</p>
          <p class="mt-1 text-3xl font-semibold text-brand-900">{{ d.out_for_delivery }}</p>
        </a>
        <div class="card p-5">
          <p class="text-sm text-slate-500">Sales today (excl. deposits)</p>
          <p class="mt-1 text-3xl font-semibold text-brand-900">{{ d.today_sales | rupees }}</p>
        </div>
        <a routerLink="/admin/enquiries" [queryParams]="{ status: 'new' }" class="card p-5 hover:border-brand-300">
          <p class="text-sm text-slate-500">New enquiries</p>
          <p class="mt-1 text-3xl font-semibold" [class]="d.new_enquiries ? 'text-amber-700' : 'text-brand-900'">{{ d.new_enquiries }}</p>
        </a>
        <a routerLink="/admin/orders" [queryParams]="{ refunds: true }" class="card p-5 hover:border-brand-300">
          <p class="text-sm text-slate-500">Paid orders to refund</p>
          <p class="mt-1 text-3xl font-semibold" [class]="d.needs_refund ? 'text-red-700' : 'text-brand-900'">{{ d.needs_refund }}</p>
        </a>
        @if (ctx.isAdmin()) {
          <a routerLink="/admin/products" class="card p-5 hover:border-brand-300">
            <p class="text-sm text-slate-500">Products low on stock (under 10)</p>
            <p class="mt-1 text-3xl font-semibold" [class]="d.low_stock ? 'text-amber-700' : 'text-brand-900'">{{ d.low_stock }}</p>
          </a>
        } @else {
          <div class="card p-5">
            <p class="text-sm text-slate-500">Products low on stock (under 10)</p>
            <p class="mt-1 text-3xl font-semibold text-brand-900">{{ d.low_stock }}</p>
          </div>
        }
      </div>
    }
  `,
})
export class AdminDashboard implements OnInit {
  private readonly api = inject(AdminApi);
  protected readonly ctx = inject(AdminContext);
  protected readonly d = signal<Dashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Today in India, for the "deliveries today" link. */
  protected readonly today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      this.d.set(await this.api.dashboard());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };
}
