import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <div class="container-page py-24 text-center">
      <p class="eyebrow">Page not found</p>
      <h1 class="mt-2 text-3xl">We couldn't find that page</h1>
      <p class="mt-3 text-slate-600">The link may be old or mistyped.</p>
      <div class="mt-8 flex justify-center gap-3">
        <a routerLink="/" class="btn-primary">Go to home page</a>
        <a routerLink="/products" class="btn-secondary">See products</a>
      </div>
    </div>
  `,
})
export class NotFound {}

/** Temporary page until checkout is built in the next phase. */
@Component({
  selector: 'app-checkout-soon',
  imports: [RouterLink],
  template: `
    <div class="container-page py-24 text-center">
      <h1 class="text-3xl">Online checkout is coming soon</h1>
      <p class="mt-3 text-slate-600">Your cart is saved. Meanwhile, please contact us to place your order.</p>
      <div class="mt-8 flex justify-center gap-3">
        <a routerLink="/cart" class="btn-secondary">Back to cart</a>
        <a routerLink="/contact" class="btn-primary">Contact us</a>
      </div>
    </div>
  `,
})
export class CheckoutSoon {}
