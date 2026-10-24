import { Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { StatusBadge, formatDateTime, formatDay } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, CustomerDetail, CustomerRow, Role } from './admin-api';
import { AdminContext } from './admin-layout';
import { AdminTitle, Flash, PAGE_SIZE, Pager } from './admin-ui';

@Component({
  selector: 'app-admin-customers',
  imports: [FormsModule, RouterLink, AdminTitle, Pager, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Customers" />
    <form class="card mb-4 flex flex-wrap items-end gap-3 p-4" (ngSubmit)="apply()" role="search">
      <div class="min-w-60 flex-1">
        <label for="c-q" class="label">Search</label>
        <input id="c-q" name="q" class="input" [(ngModel)]="fq" placeholder="Name, phone or email" />
      </div>
      <button type="submit" class="btn-primary">Search</button>
    </form>
    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error [message]="error()!" [retry]="reload" />
    } @else if (rows().length === 0) {
      <p class="card p-8 text-center text-slate-500">No customers found.</p>
    } @else {
      <div class="card relative overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr><th class="px-4 py-3">Name</th><th class="px-4 py-3">Contact</th><th class="px-4 py-3">Type</th>
                <th class="px-4 py-3 text-center">Orders</th><th class="px-4 py-3 text-center">Cans held</th><th class="px-4 py-3">Joined</th></tr>
          </thead>
          <tbody>
            @for (c of rows(); track c.id) {
              <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td class="px-4 py-3">
                  <a [routerLink]="['/admin/customers', c.id]" class="font-semibold text-brand-700 hover:underline">{{ c.full_name || '(no name)' }}</a>
                  @if (c.role !== 'customer') {<span class="ml-2 rounded-full bg-brand-50 px-2 text-xs text-brand-700">{{ c.role }}</span>}
                  @if (!c.is_active) {<span class="ml-2 rounded-full bg-slate-100 px-2 text-xs text-slate-600">blocked</span>}
                </td>
                <td class="px-4 py-3">{{ c.phone || '—' }}<div class="text-xs text-slate-500">{{ c.email }}</div></td>
                <td class="px-4 py-3 capitalize">{{ c.customer_type }}</td>
                <td class="px-4 py-3 text-center">{{ c.orders_count }}</td>
                <td class="px-4 py-3 text-center">{{ c.cans_with_deposit }}</td>
                <td class="px-4 py-3">{{ when(c.created_at) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <app-pager [page]="pageNo()" [hasMore]="rows().length === pageSize" (go)="goPage($event)" />
    }
  `,
})
export class AdminCustomers {
  readonly q = input<string>();
  readonly page = input<string>();
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly when = formatDateTime;
  protected readonly rows = signal<CustomerRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly pageNo = computed(() => Math.max(1, Number(this.page()) || 1));
  protected fq = '';

  constructor() {
    effect(() => {
      const q = this.q();
      const page = this.pageNo();
      untracked(() => {
        this.fq = q ?? '';
        this.load(q, page);
      });
    });
  }

  protected readonly reload = () => this.load(this.q(), this.pageNo());

  private async load(q: string | undefined, page: number) {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set(await this.api.customers({ q, page }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected apply() {
    this.router.navigate([], { queryParams: { q: this.fq.trim() || null } });
  }

  protected goPage(n: number) {
    this.router.navigate([], { queryParams: { page: n > 1 ? n : null }, queryParamsHandling: 'merge' });
  }
}

@Component({
  selector: 'app-admin-customer',
  imports: [FormsModule, RouterLink, RupeesPipe, StatusBadge, Flash, Spinner, ErrorBox],
  template: `
    <a routerLink="/admin/customers" class="text-sm font-medium text-brand-700 hover:underline">← Customers</a>
    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <div class="mt-4"><app-error [message]="error()!" [retry]="load" /></div>
    } @else if (c(); as c) {
      <div class="mt-4 mb-6">
        <h1 class="text-2xl">{{ c.full_name || '(no name)' }}</h1>
        <p class="text-sm text-slate-500">{{ c.email }} · {{ c.phone || 'no phone' }} · <span class="capitalize">{{ c.customer_type }}</span> · joined {{ when(c.created_at) }}</p>
      </div>
      <div class="mb-4"><app-flash [message]="msg()" [error]="msgErr()" /></div>

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          <section class="card p-5" aria-labelledby="o-title">
            <h2 id="o-title" class="text-base">Orders ({{ c.orders.length }}{{ c.orders.length === 50 ? '+' : '' }})</h2>
            @if (c.orders.length === 0) {<p class="mt-2 text-sm text-slate-500">No orders yet.</p>}
            <ul class="mt-2 divide-y divide-slate-100">
              @for (o of c.orders; track o.id) {
                <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <a [routerLink]="['/admin/orders', o.id]" class="font-semibold text-brand-700 hover:underline">{{ o.order_no }}</a>
                  <span class="text-slate-500">{{ day(o.delivery_date) }}</span>
                  <app-status-badge [status]="o.status" />
                  <span class="font-semibold">{{ o.total | rupees }}</span>
                </li>
              }
            </ul>
          </section>

          <section class="card p-5" aria-labelledby="dep-title">
            <h2 id="dep-title" class="text-base">Can deposits</h2>
            <p class="mt-1 text-sm">Cans held with a deposit: <strong>{{ c.cans_with_deposit }}</strong> · Deposit held: <strong>{{ depositHeld() | rupees }}</strong></p>
            @if (c.deposit_ledger.length) {
              <table class="mt-3 w-full text-sm">
                <thead class="text-left text-xs text-slate-500 uppercase"><tr><th class="py-1">Date</th><th class="py-1">Entry</th><th class="py-1 text-center">Cans</th><th class="py-1 text-right">Amount</th></tr></thead>
                <tbody>
                  @for (l of c.deposit_ledger; track l.id) {
                    <tr class="border-t border-slate-100">
                      <td class="py-2">{{ when(l.created_at) }}</td>
                      <td class="py-2 capitalize">{{ l.entry_type }}@if (l.note) {<div class="text-xs text-slate-500 normal-case">{{ l.note }}</div>}</td>
                      <td class="py-2 text-center">{{ l.cans_delta > 0 ? '+' : '' }}{{ l.cans_delta }}</td>
                      <td class="py-2 text-right">{{ l.amount | rupees }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            @if (ctx.isAdmin()) {
              <form class="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4" (ngSubmit)="deposit()">
                <div>
                  <label for="d-type" class="label">Entry</label>
                  <select id="d-type" name="type" class="input" [(ngModel)]="depType">
                    <option value="refunded">Cans returned, deposit refunded</option>
                    <option value="adjustment">Correction</option>
                  </select>
                </div>
                <div>
                  <label for="d-cans" class="label">{{ depType === 'refunded' ? 'Cans returned' : 'Cans (+/−)' }}</label>
                  <input id="d-cans" name="cans" type="number" class="input" [(ngModel)]="depCans" />
                </div>
                <div>
                  <label for="d-amount" class="label">{{ depType === 'refunded' ? 'Amount refunded (₹)' : 'Amount (+/− ₹)' }}</label>
                  <input id="d-amount" name="amount" type="number" step="0.01" class="input" [(ngModel)]="depAmount" />
                </div>
                <div>
                  <label for="d-note" class="label">Note</label>
                  <input id="d-note" name="note" class="input" maxlength="300" [(ngModel)]="depNote" />
                </div>
                <div class="sm:col-span-4"><button type="submit" class="btn-secondary" [disabled]="busy()">Record</button></div>
              </form>
            }
          </section>
        </div>

        <div class="space-y-6">
          <section class="card p-5" aria-labelledby="a-title">
            <h2 id="a-title" class="text-base">Addresses</h2>
            @for (a of c.addresses; track a.id) {
              <address class="mt-3 text-sm not-italic">
                <strong>{{ a.label }}</strong>@if (a.is_default) { (default)}<br />
                {{ a.contact_name }} · {{ a.contact_phone }}<br />{{ a.line1 }}@if (a.line2) {, {{ a.line2 }}}<br />{{ a.city }} – {{ a.pincode }}
              </address>
            } @empty {<p class="mt-2 text-sm text-slate-500">None saved.</p>}
          </section>

          @if (ctx.isAdmin()) {
            <section class="card p-5" aria-labelledby="r-title">
              <h2 id="r-title" class="text-base">Access</h2>
              <form class="mt-3 space-y-3" (ngSubmit)="saveRole()">
                <div>
                  <label for="role" class="label">Role</label>
                  <select id="role" name="role" class="input" [(ngModel)]="role">
                    <option value="customer">Customer</option>
                    <option value="staff">Staff (orders, customers, enquiries)</option>
                    <option value="admin">Admin (everything)</option>
                  </select>
                </div>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="active" /> Account active (can sign in and order)</label>
                <button type="submit" class="btn-secondary" [disabled]="busy()">Save access</button>
              </form>
            </section>
          }
        </div>
      </div>
    }
  `,
})
export class AdminCustomerDetail implements OnInit {
  readonly id = input.required<string>();
  private readonly api = inject(AdminApi);
  protected readonly ctx = inject(AdminContext);
  protected readonly c = signal<CustomerDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly msg = signal<string | null>(null);
  protected readonly msgErr = signal(false);
  protected readonly depositHeld = computed(() => (this.c()?.deposit_ledger ?? []).reduce((s, l) => s + Number(l.amount), 0));
  protected readonly when = formatDateTime;
  protected readonly day = formatDay;

  protected role: Role = 'customer';
  protected active = true;
  protected depType: 'refunded' | 'adjustment' = 'refunded';
  protected depCans: number | null = null;
  protected depAmount: number | null = null;
  protected depNote = '';

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      this.show(await this.api.customer(this.id()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  private show(c: CustomerDetail) {
    this.c.set(c);
    this.role = c.role;
    this.active = c.is_active;
  }

  private async run(action: () => Promise<CustomerDetail>, done: string) {
    this.busy.set(true);
    this.msg.set(null);
    try {
      this.show(await action());
      this.msgErr.set(false);
      this.msg.set(done);
      return true;
    } catch (e) {
      this.msgErr.set(true);
      this.msg.set(errorMessage(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected saveRole() {
    return this.run(() => this.api.setRole(this.id(), this.role, this.active), 'Access saved.');
  }

  protected async deposit() {
    const ok = await this.run(
      () => this.api.recordDeposit(this.id(), { entry_type: this.depType, cans: Number(this.depCans) || 0, amount: Number(this.depAmount) || 0, note: this.depNote.trim() || null }),
      'Deposit entry recorded.',
    );
    if (ok) {
      this.depCans = this.depAmount = null;
      this.depNote = '';
    }
  }
}
