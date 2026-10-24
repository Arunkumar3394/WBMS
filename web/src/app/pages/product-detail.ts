import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService, errorMessage } from '../core/api.service';
import { CartService } from '../core/cart.service';
import { Product, PublicSettings } from '../core/models';
import { ProductVisual } from '../shared/product-visual';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, FormsModule, ProductVisual, RupeesPipe, Spinner, ErrorBox],
  template: `
    <div class="container-page py-10">
      <nav aria-label="Breadcrumb" class="text-sm text-slate-500">
        <a routerLink="/products" class="hover:text-brand-700">Products</a>
        @if (product(); as p) {
          <span aria-hidden="true"> / </span><span aria-current="page">{{ p.name }}</span>
        }
      </nav>

      @if (loading()) {
        <app-spinner />
      } @else if (notFound()) {
        <div class="py-16 text-center">
          <h1 class="text-2xl">Product not found</h1>
          <p class="mt-2 text-slate-600">It may have been removed or renamed.</p>
          <a routerLink="/products" class="btn-primary mt-6">See all products</a>
        </div>
      } @else if (error()) {
        <div class="mt-6"><app-error [message]="error()!" [retry]="load" /></div>
      } @else if (product(); as p) {
        <div class="mt-6 grid gap-10 lg:grid-cols-2">
          <app-product-visual [product]="p" />
          <div>
            <p class="eyebrow">{{ p.category_name }}</p>
            <h1 class="mt-2 text-3xl sm:text-4xl">{{ p.name }}</h1>
            <p class="mt-2 text-slate-500">{{ p.unit_label }}</p>

            <div class="mt-6 flex items-center gap-3">
              <p class="text-3xl font-semibold text-brand-800">{{ p.price | rupees }}</p>
              @if (p.is_sample_price) {
                <span class="badge-sample">Sample price</span>
              }
            </div>

            @if (p.description) {
              <p class="mt-6 text-slate-700">{{ p.description }}</p>
            }

            @if (p.is_returnable_can && settings()?.deposit_enabled && p.deposit_amount > 0) {
              <p class="mt-4 rounded-xl bg-aqua-50 p-4 text-sm text-slate-700">
                <strong>Can deposit:</strong> a refundable deposit of {{ p.deposit_amount | rupees }} per can applies only to
                new cans, beyond the empty cans you hand back. The exact amount is shown at checkout.
              </p>
            }

            @if (!p.in_stock) {
              <p class="mt-8 font-medium text-red-600" role="status">Currently out of stock.</p>
            } @else {
              <form class="mt-8 flex flex-wrap items-end gap-4" (ngSubmit)="add(p)">
                <div>
                  <label for="qty" class="label">Quantity</label>
                  <div class="flex items-center rounded-full border border-slate-300">
                    <button type="button" class="h-11 w-11 rounded-full text-xl text-brand-700 disabled:opacity-40"
                            (click)="qty.set(qty() - 1)" [disabled]="qty() <= p.min_order_qty" aria-label="Decrease quantity">−</button>
                    <input id="qty" name="qty" type="number" inputmode="numeric" class="w-14 border-0 text-center focus:ring-0"
                           [min]="p.min_order_qty" [max]="p.max_order_qty" [ngModel]="qty()" (ngModelChange)="setQty($event, p)" />
                    <button type="button" class="h-11 w-11 rounded-full text-xl text-brand-700 disabled:opacity-40"
                            (click)="qty.set(qty() + 1)" [disabled]="qty() >= p.max_order_qty" aria-label="Increase quantity">+</button>
                  </div>
                </div>
                <button type="submit" class="btn-primary h-11 px-6">Add to cart</button>
              </form>
              <p class="mt-2 text-xs text-slate-500">You can order {{ p.min_order_qty }} to {{ p.max_order_qty }} at a time.</p>
              @if (added()) {
                <p class="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800" role="status">
                  Added to your cart. <a routerLink="/cart" class="font-semibold underline">View cart</a>
                </p>
              }
            }

            <p class="mt-8 text-sm text-slate-600">
              Ordering for an event or office?
              <a routerLink="/contact" [queryParams]="{ type: 'bulk_order' }" class="font-medium text-brand-700 underline">Ask for a bulk quote</a>.
            </p>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProductDetail implements OnInit {
  readonly slug = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly cart = inject(CartService);
  private readonly title = inject(Title);

  protected readonly product = signal<Product | null>(null);
  protected readonly settings = signal<PublicSettings | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly qty = signal(1);
  protected readonly added = signal(false);

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [p, s] = await Promise.all([this.api.product(this.slug()), this.api.settings().catch(() => null)]);
      this.product.set(p);
      this.settings.set(s);
      this.qty.set(p.min_order_qty);
      this.title.setTitle(`${p.name} | AquaPure Water`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) this.notFound.set(true);
      else this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected setQty(value: number, p: Product) {
    const n = Math.floor(Number(value) || p.min_order_qty);
    this.qty.set(Math.min(Math.max(n, p.min_order_qty), p.max_order_qty));
  }

  protected add(p: Product) {
    this.cart.add(p, this.qty());
    this.added.set(true);
  }
}
