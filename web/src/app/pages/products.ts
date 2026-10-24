import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { CartService } from '../core/cart.service';
import { Catalog } from '../core/models';
import { ProductCard } from '../shared/product-card';
import { ErrorBox, PageHeader, Spinner } from '../shared/ui';

@Component({
  selector: 'app-products',
  imports: [RouterLink, ProductCard, PageHeader, Spinner, ErrorBox],
  template: `
    <app-page-header eyebrow="Products" title="Water cans and bottled water"
      intro="Choose 20-litre cans for your dispenser or cases of sealed bottles. Any delivery charge for your area is shown at checkout." />

    <div class="container-page py-10">
      @if (loading()) {
        <app-spinner label="Loading products…" />
      } @else if (error()) {
        <app-error [message]="error()!" [retry]="load" />
      } @else {
        <nav aria-label="Product categories" class="flex flex-wrap gap-2">
          <a routerLink="/products" [queryParams]="{}" class="rounded-full px-4 py-2 text-sm font-medium"
             [class]="!category() ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'"
             [attr.aria-current]="!category() ? 'page' : null">All</a>
          @for (c of catalog()!.categories; track c.id) {
            <a routerLink="/products" [queryParams]="{ category: c.slug }" class="rounded-full px-4 py-2 text-sm font-medium"
               [class]="category() === c.slug ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'"
               [attr.aria-current]="category() === c.slug ? 'page' : null">{{ c.name }}</a>
          }
        </nav>

        @if (currentCategory(); as c) {
          @if (c.description) {
            <p class="mt-6 max-w-3xl text-slate-600">{{ c.description }}</p>
          }
        }

        @if (visible().length) {
          <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            @for (p of visible(); track p.id) {
              <app-product-card [product]="p" />
            }
          </div>
        } @else {
          <p class="mt-8 text-slate-600">No products in this category yet.</p>
        }

        <aside class="card mt-12 flex flex-col items-start gap-4 bg-aqua-50/60 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-lg">Need a large quantity or regular supply?</h2>
            <p class="mt-1 text-slate-600">For functions, offices and monthly supply, send us an enquiry and we will reply with a quote.</p>
          </div>
          <a routerLink="/contact" [queryParams]="{ type: 'bulk_order' }" class="btn-primary shrink-0">Send an enquiry</a>
        </aside>
      }
    </div>
  `,
})
export class Products implements OnInit {
  private readonly api = inject(ApiService);
  private readonly cart = inject(CartService);

  protected readonly catalog = signal<Catalog | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly category = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.get('category'))));

  protected readonly currentCategory = computed(() => this.catalog()?.categories.find((c) => c.slug === this.category()));
  protected readonly visible = computed(() => {
    const products = this.catalog()?.products ?? [];
    const c = this.category();
    return c ? products.filter((p) => p.category_slug === c) : products;
  });

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.loading.set(true);
    this.error.set(null);
    try {
      const catalog = await this.api.catalog();
      this.catalog.set(catalog);
      this.cart.sync(catalog.products);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };
}
