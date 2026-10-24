import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { isoDay } from '../shared/format';
import { Report } from '../shared/models';

@Component({
  selector: 'app-admin-reports',
  imports: [FormsModule, DecimalPipe, DatePipe],
  template: `
    <h1 class="h4 mb-3">Reports</h1>
    <div class="d-flex gap-2 align-items-end mb-3 flex-wrap">
      <div><label class="form-label small" for="f">From</label><input id="f" type="date" class="form-control" [(ngModel)]="from" /></div>
      <div><label class="form-label small" for="t">To</label><input id="t" type="date" class="form-control" [(ngModel)]="to" /></div>
      <button class="btn btn-primary" (click)="load()">Show</button>
      <button class="btn btn-outline-secondary" (click)="month(0)">This month</button>
      <button class="btn btn-outline-secondary" (click)="month(-1)">Last month</button>
    </div>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    @if (r(); as r) {
      <div class="row g-3 mb-4">
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Sales (₹)</div><div class="stat-value">{{ r.sales | number: '1.0-0' }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Collected (₹)</div><div class="stat-value">{{ r.collected | number: '1.0-0' }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Orders delivered</div><div class="stat-value">{{ r.delivered }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Cancelled orders</div><div class="stat-value">{{ r.cancelled }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Full cans delivered</div><div class="stat-value">{{ r.cansOut }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Empty cans collected</div><div class="stat-value">{{ r.cansIn }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Total dues today (₹)</div><div class="stat-value">{{ r.duesNow | number: '1.0-0' }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body"><div class="stat-label">Cans with customers</div><div class="stat-value">{{ r.cansWithCustomers }}</div></div></div></div>
      </div>
      <div class="row g-4">
        <div class="col-lg-6">
          <h2 class="h6">Collections by payment type</h2>
          <table class="table table-sm"><thead><tr><th>Mode</th><th class="text-end">Payments</th><th class="text-end">Amount (₹)</th></tr></thead><tbody>
            @for (m of r.byMode; track m.mode) { <tr><td>{{ m.mode }}</td><td class="text-end">{{ m.count }}</td><td class="text-end">{{ m.amount | number: '1.0-0' }}</td></tr> }
            @empty { <tr><td colspan="3" class="text-body-secondary">None</td></tr> }
          </tbody></table>
          <h2 class="h6 mt-4">Drivers</h2>
          <table class="table table-sm"><thead><tr><th>Driver</th><th class="text-end">Deliveries</th><th class="text-end">Cans out</th><th class="text-end">Empties in</th><th class="text-end">Cash (₹)</th></tr></thead><tbody>
            @for (d of r.byDriver; track d.name) { <tr><td>{{ d.name }}</td><td class="text-end">{{ d.deliveries }}</td><td class="text-end">{{ d.cansOut }}</td><td class="text-end">{{ d.cansIn }}</td><td class="text-end">{{ d.cash | number: '1.0-0' }}</td></tr> }
            @empty { <tr><td colspan="5" class="text-body-secondary">None</td></tr> }
          </tbody></table>
        </div>
        <div class="col-lg-6">
          <h2 class="h6">Daily sales</h2>
          <table class="table table-sm"><thead><tr><th>Date</th><th class="text-end">Invoices</th><th class="text-end">Sales (₹)</th></tr></thead><tbody>
            @for (d of r.daily; track d.day) { <tr><td>{{ d.day | date: 'dd MMM, EEE' }}</td><td class="text-end">{{ d.count }}</td><td class="text-end">{{ d.amount | number: '1.0-0' }}</td></tr> }
            @empty { <tr><td colspan="3" class="text-body-secondary">None</td></tr> }
          </tbody></table>
          <h2 class="h6 mt-4">Highest dues</h2>
          <table class="table table-sm"><thead><tr><th>Customer</th><th>Phone</th><th class="text-end">Due (₹)</th><th class="text-end">Cans held</th></tr></thead><tbody>
            @for (c of r.topDues; track c.customerId) { <tr><td>{{ c.name }}</td><td>{{ c.phone }}</td><td class="text-end text-danger">{{ c.due | number: '1.0-0' }}</td><td class="text-end">{{ c.cans }}</td></tr> }
            @empty { <tr><td colspan="4" class="text-body-secondary">No dues</td></tr> }
          </tbody></table>
        </div>
      </div>
    }
  `,
})
export class AdminReports {
  private api = inject(ApiService);
  r = signal<Report | null>(null);
  error = signal<string | null>(null);
  from = '';
  to = '';

  constructor() {
    this.month(0);
  }

  month(offset: number) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    this.from = isoDay(first);
    this.to = offset === 0 ? isoDay(now) : isoDay(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.r.set(await this.api.report(this.from, this.to));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
