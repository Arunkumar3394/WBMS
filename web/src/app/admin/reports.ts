import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.service';
import { addDays, formatDay, statusLabel } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, SalesReport } from './admin-api';
import { AdminTitle, downloadCsv } from './admin-ui';

@Component({
  selector: 'app-admin-reports',
  imports: [FormsModule, RupeesPipe, AdminTitle, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Sales report" subtitle="By order date. Sales exclude refundable can deposits; cancelled orders are left out.">
      <button type="button" class="btn-secondary" [disabled]="!r()" (click)="exportCsv()">Download CSV</button>
    </app-admin-title>

    <form class="card mb-6 flex flex-wrap items-end gap-3 p-4" (ngSubmit)="load()">
      <div>
        <label for="r-from" class="label">From</label>
        <input id="r-from" name="from" type="date" class="input" [(ngModel)]="from" required />
      </div>
      <div>
        <label for="r-to" class="label">To</label>
        <input id="r-to" name="to" type="date" class="input" [(ngModel)]="to" required />
      </div>
      <button type="submit" class="btn-primary">Show</button>
      <div class="flex flex-wrap gap-2 text-sm">
        <button type="button" class="rounded-full border border-slate-300 bg-white px-3 py-1.5" (click)="preset(0)">Today</button>
        <button type="button" class="rounded-full border border-slate-300 bg-white px-3 py-1.5" (click)="preset(6)">Last 7 days</button>
        <button type="button" class="rounded-full border border-slate-300 bg-white px-3 py-1.5" (click)="preset(29)">Last 30 days</button>
      </div>
    </form>

    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error [message]="error()!" [retry]="load" />
    } @else if (r(); as r) {
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="card p-5"><p class="text-sm text-slate-500">Sales</p><p class="mt-1 text-2xl font-semibold text-brand-900">{{ r.totals.sales | rupees }}</p></div>
        <div class="card p-5"><p class="text-sm text-slate-500">Collected (paid)</p><p class="mt-1 text-2xl font-semibold text-brand-900">{{ r.totals.collected | rupees }}</p></div>
        <div class="card p-5"><p class="text-sm text-slate-500">Cash on delivery still to collect</p><p class="mt-1 text-2xl font-semibold text-brand-900">{{ r.totals.cod_outstanding | rupees }}</p></div>
        <div class="card p-5"><p class="text-sm text-slate-500">Can deposits taken</p><p class="mt-1 text-2xl font-semibold text-brand-900">{{ r.totals.deposits | rupees }}</p></div>
        <div class="card p-5"><p class="text-sm text-slate-500">Orders</p><p class="mt-1 text-2xl font-semibold text-brand-900">{{ r.totals.orders }}</p>
          <p class="text-xs text-slate-500">{{ r.totals.delivered }} delivered · {{ r.totals.open }} open · {{ r.totals.cancelled }} cancelled</p></div>
        <div class="card p-5"><p class="text-sm text-slate-500">Paid orders needing a refund</p><p class="mt-1 text-2xl font-semibold" [class]="r.totals.needs_refund ? 'text-red-700' : 'text-brand-900'">{{ r.totals.needs_refund }}</p></div>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <section class="card p-5" aria-labelledby="day-title">
          <h2 id="day-title" class="text-base">Sales by day</h2>
          @if (r.by_day.length === 0) {<p class="mt-2 text-sm text-slate-500">No orders in this period.</p>}
          <table class="mt-3 w-full text-sm">
            <thead class="sr-only"><tr><th>Day</th><th>Orders</th><th>Sales</th></tr></thead>
            <tbody>
              @for (d of r.by_day; track d.day) {
                <tr>
                  <td class="w-28 py-1 whitespace-nowrap">{{ day(d.day) }}</td>
                  <td class="py-1">
                    <div class="h-4 rounded bg-brand-500" [style.width.%]="maxDay() ? (d.sales / maxDay()) * 100 : 0" aria-hidden="true"></div>
                  </td>
                  <td class="w-32 py-1 text-right whitespace-nowrap">{{ d.sales | rupees }} <span class="text-xs text-slate-500">({{ d.orders }})</span></td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="card p-5" aria-labelledby="prod-title">
          <h2 id="prod-title" class="text-base">By product</h2>
          @if (r.by_product.length === 0) {<p class="mt-2 text-sm text-slate-500">No sales in this period.</p>}
          <table class="mt-3 w-full text-sm">
            <thead class="text-left text-xs text-slate-500 uppercase"><tr><th class="py-1">Product</th><th class="py-1 text-center">Qty</th><th class="py-1 text-right">Sales</th></tr></thead>
            <tbody>
              @for (p of r.by_product; track p.name) {
                <tr class="border-t border-slate-100"><td class="py-2">{{ p.name }}</td><td class="py-2 text-center">{{ p.quantity }}</td><td class="py-2 text-right">{{ p.sales | rupees }}</td></tr>
              }
            </tbody>
          </table>
          <h3 class="mt-5 text-sm">Orders by status</h3>
          <ul class="mt-2 flex flex-wrap gap-2 text-sm">
            @for (s of statusCounts(); track s.label) {<li class="rounded-full bg-slate-100 px-3 py-1">{{ s.label }}: {{ s.n }}</li>}
          </ul>
        </section>
      </div>
    }
  `,
})
export class AdminReports implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  protected from = addDays(this.today, -6);
  protected to = this.today;
  protected readonly r = signal<SalesReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly day = formatDay;
  protected readonly maxDay = computed(() => Math.max(0, ...(this.r()?.by_day ?? []).map((d) => Number(d.sales))));
  protected readonly statusCounts = computed(() =>
    Object.entries(this.r()?.by_status ?? {}).map(([s, n]) => ({ label: statusLabel(s as never), n })),
  );

  ngOnInit() {
    this.load();
  }

  protected preset(days: number) {
    this.from = addDays(this.today, -days);
    this.to = this.today;
    this.load();
  }

  protected readonly load = async () => {
    if (!this.from || !this.to) return;
    if (this.from > this.to) [this.from, this.to] = [this.to, this.from];
    this.loading.set(true);
    this.error.set(null);
    try {
      this.r.set(await this.api.sales(this.from, this.to));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected exportCsv() {
    const r = this.r()!;
    downloadCsv(`aquapure-sales-${r.from}-to-${r.to}.csv`, [
      ['Day', 'Orders', 'Sales (excl. deposits)'],
      ...r.by_day.map((d) => [d.day, d.orders, d.sales]),
      [],
      ['Product', 'Quantity', 'Sales'],
      ...r.by_product.map((p) => [p.name, p.quantity, p.sales]),
      [],
      ['Total sales', '', r.totals.sales],
      ['Collected', '', r.totals.collected],
      ['COD outstanding', '', r.totals.cod_outstanding],
      ['Deposits', '', r.totals.deposits],
    ]);
  }
}
