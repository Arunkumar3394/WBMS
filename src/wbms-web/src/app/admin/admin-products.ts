import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Product } from '../shared/models';

@Component({
  selector: 'app-admin-products',
  imports: [FormsModule],
  template: `
    <h1 class="h4 mb-3">Products &amp; stock</h1>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    <form class="row g-2 align-items-end mb-4" (ngSubmit)="add()">
      <div class="col-md-4"><label class="form-label small">Product name</label><input class="form-control" name="n" [(ngModel)]="name" required /></div>
      <div class="col-md-2"><label class="form-label small">Price (₹)</label><input type="number" class="form-control" name="p" [(ngModel)]="price" /></div>
      <div class="col-md-3 d-flex align-items-center"><div class="form-check">
        <input id="ret" class="form-check-input" type="checkbox" name="r" [(ngModel)]="returnable" />
        <label for="ret" class="form-check-label">Returnable can</label></div></div>
      <div class="col-md-3"><button class="btn btn-success w-100" [disabled]="busy()">Add product</button></div>
    </form>
    <table class="table align-middle">
      <thead><tr><th>Product</th><th>Price (₹)</th><th class="text-end">Full in stock</th><th>Add filled stock</th><th></th></tr></thead>
      <tbody>
        @for (p of products(); track p.id) {
          <tr [class.text-body-secondary]="!p.isActive">
            <td>{{ p.name }} @if (p.isReturnable) { <span class="badge text-bg-light">Returnable</span> }
              @if (!p.isActive) { <span class="badge text-bg-secondary">Not on sale</span> }</td>
            <td><input type="number" class="form-control form-control-sm price" [ngModel]="p.price" (change)="setPrice(p, $any($event.target).value)" /></td>
            <td class="text-end" [class.text-danger]="p.stockFull < 20">{{ p.stockFull }}</td>
            <td>
              <div class="input-group input-group-sm fill">
                <input type="number" class="form-control" [(ngModel)]="fill[p.id]" placeholder="Qty" />
                <button class="btn btn-outline-primary" (click)="addStock(p)" [disabled]="busy() || !fill[p.id]">Add</button>
              </div>
            </td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-secondary" (click)="toggle(p)" [disabled]="busy()">{{ p.isActive ? 'Stop selling' : 'Sell again' }}</button>
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class AdminProducts {
  private api = inject(ApiService);
  products = signal<Product[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);
  fill: Record<number, number | null> = {};
  name = ''; price = 0; returnable = true;

  constructor() {
    this.load();
  }

  async load() {
    try {
      this.products.set(await this.api.products(true));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private async act(fn: () => Promise<unknown>) {
    this.error.set(null);
    this.busy.set(true);
    try {
      await fn();
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  add() {
    return this.act(async () => {
      await this.api.addProduct({ name: this.name, price: this.price, isReturnable: this.returnable });
      this.name = '';
      this.price = 0;
    });
  }
  setPrice(p: Product, v: string) { return this.act(() => this.api.updateProduct(p.id, { price: Number(v) })); }
  toggle(p: Product) { return this.act(() => this.api.updateProduct(p.id, { isActive: !p.isActive })); }
  addStock(p: Product) {
    return this.act(async () => {
      await this.api.fillStock(p.id, this.fill[p.id]!);
      this.fill[p.id] = null;
    });
  }
}
