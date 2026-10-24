import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Testimonial } from '../core/models';

/** Customer reviews. Sample reviews are always labelled as such. */
@Component({
  selector: 'app-testimonials',
  template: `
    @if (items().length) {
      <section class="section bg-aqua-50/60" aria-labelledby="reviews-title">
        <div class="container-page">
          <p class="eyebrow">Customer reviews</p>
          <h2 id="reviews-title" class="mt-2 text-3xl">What customers say</h2>
          <div class="mt-8 grid gap-6 md:grid-cols-3">
            @for (t of items(); track t.id) {
              <figure class="card flex flex-col p-6">
                @if (t.rating) {
                  <p class="text-amber-500" [attr.aria-label]="t.rating + ' out of 5'">{{ stars(t.rating) }}</p>
                }
                <blockquote class="mt-3 flex-1 text-slate-700">“{{ t.content }}”</blockquote>
                <figcaption class="mt-4 text-sm">
                  <span class="font-semibold text-brand-900">{{ t.author_name }}</span>
                  @if (t.author_location) {
                    <span class="text-slate-500"> · {{ t.author_location }}</span>
                  }
                  @if (t.is_sample) {
                    <span class="badge-sample ml-2">Sample review</span>
                  }
                </figcaption>
              </figure>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class Testimonials implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly items = signal<Testimonial[]>([]);

  async ngOnInit() {
    try {
      this.items.set((await this.api.testimonials()).slice(0, 3));
    } catch {
      // Reviews are optional; hide the section if they cannot be loaded.
    }
  }

  protected stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
}
