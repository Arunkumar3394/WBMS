import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { CartLine, CartService } from '../core/cart.service';
import { ProductVisual } from '../shared/product-visual';
import { RupeesPipe } from '../shared/rupees.pipe';
import { PageHeader } from '../shared/ui';

@Component({
  selector: 'app-cart',
  imports: [RouterLink, ProductVisual, RupeesPipe, PageHeader],
  template: `
    <app-page-header title="Your cart" />
    <div class="container-page py-10">
      @if (cart.lines().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-lg text-slate-700">Your cart is empty.</p>
          <a routerLink="/products" class="btn-primary mt-6">Browse products</a>
        </div>
      } @else {
        <div class="grid gap-8 lg:grid-cols-3">
          <ul class="space-y-4 lg:col-span-2" aria-label="Items in your cart">
            @for (l of cart.lines(); track l.product_id) {
              <li class="card flex gap-4 p-4">
                <div class="w-24 shrink-0 sm:w-32">
                  <app-product-visual [product]="{ name: l.name, image_url: l.image_url, category_slug: l.category_slug }" />
                </div>
                <div class="flex flex-1 flex-col">
                  <div class="flex justify-between gap-2">
                    <div>
                      <a [routerLink]="['/products', l.slug]" class="font-semibold text-brand-900 hover:underline">{{ l.name }}</a>
                      <p class="text-sm text-slate-500">{{ l.unit_label }} · {{ l.price | rupees }} each</p>
                    </div>
                    <p class="font-semibold text-brand-800">{{ l.price * l.quantity | rupees }}</p>
                  </div>
                  <div class="mt-auto flex items-center justify-between pt-3">
                    <div class="flex items-center rounded-full border border-slate-300" role="group" [attr.aria-label]="'Quantity of ' + l.name">
                      <button type="button" class="h-9 w-9 rounded-full text-lg text-brand-700 disabled:opacity-40"
                              (click)="change(l, -1)" [disabled]="l.quantity <= l.min_order_qty" [attr.aria-label]="'Decrease ' + l.name">−</button>
                      <span class="w-10 text-center" aria-live="polite">{{ l.quantity }}</span>
                      <button type="button" class="h-9 w-9 rounded-full text-lg text-brand-700 disabled:opacity-40"
                              (click)="change(l, 1)" [disabled]="l.quantity >= l.max_order_qty" [attr.aria-label]="'Increase ' + l.name">+</button>
                    </div>
                    <button type="button" class="text-sm font-medium text-red-600 hover:underline" (click)="cart.remove(l.product_id)">Remove</button>
                  </div>
                </div>
              </li>
            }
          </ul>

          <aside class="card h-fit p-6" aria-labelledby="summary-title">
            <h2 id="summary-title" class="text-lg">Order summary</h2>
            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between"><dt>Items ({{ cart.count() }})</dt><dd>{{ cart.subtotal() | rupees }}</dd></div>
              <div class="flex justify-between text-slate-500"><dt>Delivery charge</dt><dd>At checkout</dd></div>
              <div class="flex justify-between text-slate-500"><dt>Can deposit (if any)</dt><dd>At checkout</dd></div>
            </dl>
            <p class="mt-4 text-xs text-slate-500">
              The final total, including the delivery charge for your pincode and any refundable can deposit, is worked out
              when you choose your address at checkout.
            </p>
            <a routerLink="/checkout" class="btn-primary mt-6 w-full">Continue to checkout</a>
            <a routerLink="/products" class="btn-secondary mt-3 w-full">Keep shopping</a>
          </aside>
        </div>
      }
    </div>
  `,
})
export class Cart implements OnInit {
  protected readonly cart = inject(CartService);
  private readonly api = inject(ApiService);

  async ngOnInit() {
    // Refresh prices and availability so the cart never shows stale numbers.
    try {
      this.cart.sync((await this.api.catalog()).products);
    } catch {
      // Offline: show what we have; checkout re-checks everything anyway.
    }
  }

  protected change(l: CartLine, delta: number) {
    this.cart.setQuantity(l.product_id, l.quantity + delta);
  }
}
