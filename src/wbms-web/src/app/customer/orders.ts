import { CurrencyPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Order } from '../shared/models';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-orders',
  imports: [RouterLink, CurrencyPipe, StatusBadge],
  template: `
    <h1 class="h4 mb-3">Your orders</h1>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    @if (orders(); as list) {
      @if (list.length === 0) {
        <p>No orders yet. <a routerLink="/">Book water</a></p>
      }
      <div class="list-group">
        @for (o of list; track o.id) {
          <a class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" [routerLink]="['/orders', o.id]">
            <span>
              <span class="fw-semibold">{{ itemsText(o) }}</span>
              <span class="text-body-secondary small d-block">{{ o.slotDate }} · {{ o.orderNo }} · {{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
            </span>
            <app-status [status]="o.status" />
          </a>
        }
      </div>
    } @else if (!error()) {
      <p class="text-body-secondary">Loading…</p>
    }
  `,
})
export class Orders {
  private api = inject(ApiService);
  orders = signal<Order[] | null>(null);
  error = signal<string | null>(null);

  constructor() {
    this.api.orders().then((o) => this.orders.set(o), (e) => this.error.set(errorMessage(e)));
  }

  itemsText(o: Order) {
    return o.items.map((i) => `${i.qty} × ${i.product}`).join(', ');
  }
}
