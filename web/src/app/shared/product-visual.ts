import { Component, computed, input } from '@angular/core';
import { Product } from '../core/models';

/**
 * Product picture: the uploaded image if there is one; otherwise a neutral stand-in
 * (an unbranded can photo for cans, a drawn bottle for bottled water).
 */
@Component({
  selector: 'app-product-visual',
  template: `
    <div class="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-aqua-50 to-brand-50">
      @if (src(); as s) {
        <img [src]="s" [alt]="product().name" class="h-full w-full object-cover" loading="lazy" width="400" height="300" />
      } @else {
        <svg viewBox="0 0 120 120" class="h-3/4 text-brand-500" role="img" [attr.aria-label]="product().name">
          <defs>
            <linearGradient id="bottle-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#cffafe" />
              <stop offset="1" stop-color="#93c5fd" />
            </linearGradient>
          </defs>
          <rect x="50" y="8" width="20" height="10" rx="3" fill="#1d4ed8" />
          <path d="M48 18h24v10c0 4 10 8 10 18v58a8 8 0 0 1-8 8H46a8 8 0 0 1-8-8V46c0-10 10-14 10-18z"
                fill="url(#bottle-fill)" stroke="#2563eb" stroke-width="2" />
          <rect x="40" y="58" width="40" height="22" rx="4" fill="#fff" opacity=".85" />
          <path d="M60 63c0 0-6 6.5-6 10a6 6 0 0 0 12 0c0-3.5-6-10-6-10z" fill="#06b6d4" />
        </svg>
      }
    </div>
  `,
})
export class ProductVisual {
  readonly product = input.required<Pick<Product, 'name' | 'image_url' | 'category_slug'>>();

  protected readonly src = computed(() => {
    const p = this.product();
    if (p.image_url) return p.image_url;
    return p.category_slug === 'water-cans' ? '/images/water-cans/can-on-dispenser.webp' : null;
  });
}
