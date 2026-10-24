import { Component, input, output } from '@angular/core';

/** Title row for admin pages, with room for buttons on the right. */
@Component({
  selector: 'app-admin-title',
  template: `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl">{{ title() }}</h1>
        @if (subtitle()) {<p class="mt-1 text-sm text-slate-500">{{ subtitle() }}</p>}
      </div>
      <div class="flex flex-wrap gap-2"><ng-content /></div>
    </div>
  `,
})
export class AdminTitle {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}

/** Previous / next page buttons for lists that load 25 rows at a time. */
@Component({
  selector: 'app-pager',
  template: `
    @if (page() > 1 || hasMore()) {
      <nav class="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
        <button type="button" class="btn-secondary" [disabled]="page() <= 1" (click)="go.emit(page() - 1)">← Previous</button>
        <span class="text-slate-500">Page {{ page() }}</span>
        <button type="button" class="btn-secondary" [disabled]="!hasMore()" (click)="go.emit(page() + 1)">Next →</button>
      </nav>
    }
  `,
})
export class Pager {
  readonly page = input.required<number>();
  readonly hasMore = input.required<boolean>();
  readonly go = output<number>();
}

/** A short green or red message after saving. */
@Component({
  selector: 'app-flash',
  template: `
    @if (message()) {
      <p class="rounded-xl p-3 text-sm" [class]="error() ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'" [attr.role]="error() ? 'alert' : 'status'">{{ message() }}</p>
    }
  `,
})
export class Flash {
  readonly message = input<string | null>(null);
  readonly error = input(false);
}

export const PAGE_SIZE = 25;

/** Downloads rows as a CSV file (opens in Excel). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formulas in customer-entered text
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
