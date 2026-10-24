import { CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { isoDay } from '../shared/format';
import { Order } from '../shared/models';
import { StatusBadge } from '../shared/status-badge';

/** The driver's assigned orders: to deliver first, then what they finished today. Refreshes every 30 seconds. */
@Component({
  selector: 'app-driver-orders',
  imports: [RouterLink, CurrencyPipe, StatusBadge],
  template: `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h1 class="h4 mb-0">To deliver</h1>
      <button class="btn btn-sm btn-outline-primary" (click)="load()">Refresh</button>
    </div>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    <div class="list-group mb-4">
      @for (o of toDeliver(); track o.id) {
        <a class="list-group-item list-group-item-action py-3" [routerLink]="['/driver/orders', o.id]">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">{{ o.customerName }}</div>
              <div class="small">{{ o.address }}</div>
              <div class="small text-body-secondary">{{ itemsText(o) }} · {{ o.slotDate }}</div>
            </div>
            <div class="text-end">
              <app-status [status]="o.status" [staff]="true" />
              @if (o.paymentMode === 'Cash') { <div class="small mt-1">Collect {{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}</div> }
            </div>
          </div>
        </a>
      } @empty {
        <div class="list-group-item text-body-secondary py-4 text-center">{{ loaded() ? 'Nothing to deliver right now.' : 'Loading…' }}</div>
      }
    </div>
    @if (doneToday().length) {
      <h2 class="h6 text-uppercase text-body-secondary">Delivered today ({{ doneToday().length }})</h2>
      <ul class="list-group">
        @for (o of doneToday(); track o.id) {
          <li class="list-group-item small d-flex justify-content-between"><span>{{ o.customerName }} · {{ itemsText(o) }}</span><span>{{ o.orderNo }}</span></li>
        }
      </ul>
    }
  `,
})
export class DriverOrders implements OnDestroy {
  private api = inject(ApiService);
  private timer = setInterval(() => this.load(), 30_000);
  orders = signal<Order[]>([]);
  loaded = signal(false);
  error = signal<string | null>(null);

  toDeliver = computed(() =>
    this.orders().filter((o) => o.status === 'Assigned' || o.status === 'OutForDelivery')
      .sort((a, b) => (a.status === 'OutForDelivery' ? -1 : 0) - (b.status === 'OutForDelivery' ? -1 : 0) || a.slotDate.localeCompare(b.slotDate)));
  doneToday = computed(() => this.orders().filter((o) => o.status === 'Completed' && o.slotDate === isoDay(new Date())));

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async load() {
    try {
      this.orders.set(await this.api.orders());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loaded.set(true);
    }
  }

  itemsText(o: Order) {
    return o.items.map((i) => `${i.qty} × ${i.product}`).join(', ');
  }
}
