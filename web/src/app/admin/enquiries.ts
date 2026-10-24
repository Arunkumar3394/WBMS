import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { EnquiryType } from '../core/models';
import { formatDateTime, formatDay } from '../shared/order-ui';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, Enquiry, EnquiryStatus } from './admin-api';
import { AdminTitle, PAGE_SIZE, Pager } from './admin-ui';

const TYPES: Record<EnquiryType, string> = {
  general: 'General',
  bulk_order: 'Bulk order',
  monthly_supply: 'Monthly supply',
  office_supply: 'Office supply',
  event: 'Event',
};
const STATUS: Record<EnquiryStatus, string> = { new: 'New', in_progress: 'In progress', closed: 'Closed' };

@Component({
  selector: 'app-admin-enquiries',
  imports: [FormsModule, AdminTitle, Pager, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Enquiries" subtitle="Contact form, bulk-order and monthly-supply requests." />
    <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show">
      @for (f of filters; track f.value) {
        <button type="button" class="rounded-full border px-3 py-1.5 text-sm"
                [class]="(status() ?? '') === f.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'"
                [attr.aria-pressed]="(status() ?? '') === f.value" (click)="filter(f.value)">{{ f.label }}</button>
      }
    </div>
    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error [message]="error()!" [retry]="reload" />
    } @else if (rows().length === 0) {
      <p class="card p-8 text-center text-slate-500">No enquiries here.</p>
    } @else {
      <ul class="space-y-4">
        @for (e of rows(); track e.id) {
          <li class="card p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-semibold text-brand-900">{{ e.name }}@if (e.company) {<span class="font-normal text-slate-500"> · {{ e.company }}</span>}</p>
                <p class="text-sm">
                  <a class="text-brand-700 underline" [href]="'tel:' + e.phone">{{ e.phone }}</a>
                  @if (e.email) { · <a class="text-brand-700 underline" [href]="'mailto:' + e.email">{{ e.email }}</a>}
                </p>
              </div>
              <div class="text-right text-xs text-slate-500">
                <span class="rounded-full bg-aqua-50 px-2 py-0.5 font-semibold text-aqua-700">{{ types[e.enquiry_type] }}</span>
                <p class="mt-1">{{ when(e.created_at) }}</p>
              </div>
            </div>
            <p class="mt-3 text-sm whitespace-pre-line">{{ e.message }}</p>
            @if (e.quantity_note || e.preferred_date) {
              <p class="mt-2 text-sm text-slate-600">
                @if (e.quantity_note) {Quantity: {{ e.quantity_note }}. }
                @if (e.preferred_date) {Preferred date: {{ day(e.preferred_date) }}.}
              </p>
            }
            <form class="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end" (ngSubmit)="save(e, st.value, notes.value)">
              <div>
                <label [for]="'st-' + e.id" class="label">Status</label>
                <select #st [id]="'st-' + e.id" class="input" [value]="e.status">
                  @for (s of statusKeys; track s) {<option [value]="s" [selected]="s === e.status">{{ statusLabels[s] }}</option>}
                </select>
              </div>
              <div>
                <label [for]="'n-' + e.id" class="label">Notes</label>
                <input #notes [id]="'n-' + e.id" class="input" maxlength="1000" [value]="e.admin_notes ?? ''" />
              </div>
              <button type="submit" class="btn-secondary" [disabled]="saving() === e.id">{{ saved() === e.id ? 'Saved ✓' : 'Save' }}</button>
            </form>
          </li>
        }
      </ul>
      @if (saveError()) {<p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ saveError() }}</p>}
      <app-pager [page]="pageNo()" [hasMore]="rows().length === pageSize" (go)="goPage($event)" />
    }
  `,
})
export class AdminEnquiries {
  readonly status = input<string>();
  readonly page = input<string>();
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  protected readonly types = TYPES;
  protected readonly statusLabels = STATUS;
  protected readonly statusKeys = Object.keys(STATUS) as EnquiryStatus[];
  protected readonly filters = [{ value: '', label: 'All' }, ...this.statusKeys.map((s) => ({ value: s, label: STATUS[s] }))];
  protected readonly pageSize = PAGE_SIZE;
  protected readonly when = formatDateTime;
  protected readonly day = formatDay;
  protected readonly rows = signal<Enquiry[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal<string | null>(null);
  protected readonly saved = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly pageNo = computed(() => Math.max(1, Number(this.page()) || 1));

  constructor() {
    effect(() => {
      const status = this.status();
      const page = this.pageNo();
      untracked(() => this.load(status, page));
    });
  }

  protected readonly reload = () => this.load(this.status(), this.pageNo());

  private async load(status: string | undefined, page: number) {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set(await this.api.enquiries({ status, page }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected filter(status: string) {
    this.router.navigate([], { queryParams: { status: status || null } });
  }

  protected goPage(n: number) {
    this.router.navigate([], { queryParams: { page: n > 1 ? n : null }, queryParamsHandling: 'merge' });
  }

  protected async save(e: Enquiry, status: string, notes: string) {
    this.saving.set(e.id);
    this.saved.set(null);
    this.saveError.set(null);
    try {
      const updated = await this.api.updateEnquiry(e.id, status as EnquiryStatus, notes.trim() || null);
      this.rows.update((rows) => rows.map((r) => (r.id === e.id ? updated : r)));
      this.saved.set(e.id);
    } catch (err) {
      this.saveError.set(errorMessage(err));
    } finally {
      this.saving.set(null);
    }
  }
}
