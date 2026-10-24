import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../core/models';
import { ProductVisual } from './product-visual';
import { RupeesPipe } from './rupees.pipe';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, ProductVisual, RupeesPipe],
  template: `
    <article class="card flex h-full flex-col p-4 transition-shadow hover:shadow-md">
      <app-product-visual [product]="product()" />
      <div class="mt-4 flex flex-1 flex-col">
        <h3 class="text-lg">
          <a [routerLink]="['/products', product().slug]" class="after:absolute after:inset-0 focus-visible:outline-none">{{ product().name }}</a>
        </h3>
        <p class="mt-1 text-sm text-slate-500">{{ product().unit_label }}</p>
        @if (product().short_description) {
          <p class="mt-2 text-sm text-slate-600">{{ product().short_description }}</p>
        }
        <div class="mt-auto flex items-end justify-between gap-2 pt-4">
          <div>
            <p class="text-xl font-semibold text-brand-800">{{ product().price | rupees }}</p>
            @if (product().is_sample_price) {
              <span class="badge-sample mt-1">Sample price</span>
            }
          </div>
          @if (!product().in_stock) {
            <span class="text-sm font-medium text-red-600">Out of stock</span>
          } @else {
            <span class="text-sm font-medium text-brand-600" aria-hidden="true">View →</span>
          }
        </div>
      </div>
    </article>
  `,
  host: { class: 'relative block' },
})
export class ProductCard {
  readonly product = input.required<Product>();
}
