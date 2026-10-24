import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** AquaPure word mark with a water-drop icon (drawn here; no third-party logo). */
@Component({
  selector: 'app-logo',
  imports: [RouterLink],
  template: `
    <a routerLink="/" class="flex items-center gap-2 rounded-lg" aria-label="AquaPure Water home">
      <svg viewBox="0 0 32 32" class="h-9 w-9 shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#67e8f9" />
            <stop offset="1" stop-color="#1d4ed8" />
          </linearGradient>
        </defs>
        <path d="M16 2C16 2 6 13.2 6 19.5 6 25.3 10.5 30 16 30s10-4.7 10-10.5C26 13.2 16 2 16 2z" fill="url(#drop)" />
        <path d="M11.5 19.5c0 2.9 2 5 4.5 5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8" />
      </svg>
      <span class="text-lg leading-tight font-bold" [class.text-white]="light()" [class.text-brand-800]="!light()">
        AquaPure <span class="font-medium" [class.text-aqua-200]="light()" [class.text-aqua-700]="!light()">Water</span>
      </span>
    </a>
  `,
})
export class Logo {
  readonly light = input(false);
}

/** Heading block used at the top of inner pages. */
@Component({
  selector: 'app-page-header',
  template: `
    <section class="bg-gradient-to-b from-brand-50 to-white">
      <div class="container-page py-12 sm:py-16">
        @if (eyebrow()) {
          <p class="eyebrow">{{ eyebrow() }}</p>
        }
        <h1 class="mt-2 text-3xl sm:text-4xl">{{ title() }}</h1>
        @if (intro()) {
          <p class="mt-4 max-w-2xl text-lg text-slate-600">{{ intro() }}</p>
        }
        <ng-content />
      </div>
    </section>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly eyebrow = input<string>();
  readonly intro = input<string>();
}

/** Loading spinner with an accessible label. */
@Component({
  selector: 'app-spinner',
  template: `
    <div class="flex items-center justify-center gap-3 py-10 text-slate-500" role="status">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"></span>
      <span>{{ label() }}</span>
    </div>
  `,
})
export class Spinner {
  readonly label = input('Loading…');
}

/** Error box with an optional retry button. */
@Component({
  selector: 'app-error',
  template: `
    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
      <p>{{ message() }}</p>
      @if (retry()) {
        <button type="button" class="btn-secondary mt-3" (click)="retry()!()">Try again</button>
      }
    </div>
  `,
})
export class ErrorBox {
  readonly message = input.required<string>();
  readonly retry = input<() => void>();
}
