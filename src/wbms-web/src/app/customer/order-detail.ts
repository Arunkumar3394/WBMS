import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { STATUS_TEXT, isActive } from '../shared/format';
import { Order, OrderStatus } from '../shared/models';
import { StatusBadge } from '../shared/status-badge';

const STEPS: { label: string; reached: OrderStatus[] }[] = [
  { label: 'Booked', reached: ['Placed', 'PaymentPending', 'Paid', 'OnCredit', 'Confirmed', 'Assigned', 'OutForDelivery', 'Delivered', 'Completed'] },
  { label: 'Confirmed', reached: ['Confirmed', 'Assigned', 'OutForDelivery', 'Delivered', 'Completed'] },
  { label: 'Driver assigned', reached: ['Assigned', 'OutForDelivery', 'Delivered', 'Completed'] },
  { label: 'On the way', reached: ['OutForDelivery', 'Delivered', 'Completed'] },
  { label: 'Delivered', reached: ['Delivered', 'Completed'] },
];

/** One order: progress, the driver's position while on the way (refreshed every 10 seconds), pay, cancel, invoice. */
@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, CurrencyPipe, DatePipe, StatusBadge],
  template: `
    <a routerLink="/orders" class="small">← All orders</a>
    @if (error()) { <div class="alert alert-danger py-2 mt-2">{{ error() }}</div> }
    @if (order(); as o) {
      <div class="d-flex justify-content-between align-items-start mt-2 mb-3">
        <div>
          <h1 class="h4 mb-0">Order {{ o.orderNo }}</h1>
          <div class="text-body-secondary small">For {{ o.slotDate }} · {{ o.address }}</div>
        </div>
        <app-status [status]="o.status" />
      </div>

      @if (o.status !== 'Cancelled' && o.status !== 'Failed') {
        <ol class="steps mb-4">
          @for (s of steps; track s.label) {
            <li [class.done]="s.reached.includes(o.status)">{{ s.label }}</li>
          }
        </ol>
      }

      @if (o.status === 'PaymentPending') {
        <div class="alert alert-warning d-flex justify-content-between align-items-center">
          <span>Waiting for your payment of {{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}.</span>
          <button class="btn btn-warning" (click)="pay()" [disabled]="busy()">Pay now</button>
        </div>
      }

      @if (o.status === 'OutForDelivery') {
        <div class="card mb-4 border-primary">
          <div class="card-body">
            <p class="mb-2"><strong>{{ o.driverName }}</strong> is on the way.
              When the cans arrive, tell the driver the 4-digit code we sent you by SMS.</p>
            @if (o.driverPhone) { <a class="btn btn-outline-primary btn-sm mb-3" [href]="'tel:' + o.driverPhone">Call driver</a> }
            @if (mapUrl(); as url) {
              <iframe class="map" [src]="url" title="Driver location"></iframe>
              <div class="small text-body-secondary mt-1">
                Location updated {{ o.driverLocationAt | date: 'shortTime' }} ·
                <a [href]="googleMaps()" target="_blank" rel="noopener">Open in Google Maps</a>
              </div>
            } @else {
              <p class="small text-body-secondary mb-0">The driver's location will show here once their phone shares it.</p>
            }
          </div>
        </div>
      } @else if (o.status === 'Assigned') {
        <p class="mb-4">{{ o.driverName }} will deliver your order.</p>
      }

      <div class="card mb-3">
        <ul class="list-group list-group-flush">
          @for (i of o.items; track i.productId) {
            <li class="list-group-item d-flex justify-content-between">
              <span>{{ i.qty }} × {{ i.product }}</span>
              <span>{{ i.qty * i.unitPrice | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
            </li>
          }
          <li class="list-group-item d-flex justify-content-between fw-semibold">
            <span>Total ({{ payText() }})</span>
            <span>{{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
          </li>
        </ul>
      </div>
      @if (o.notes) { <p class="small text-body-secondary">Note: {{ o.notes }}</p> }

      <div class="d-flex gap-2">
        @if (o.invoiceId) {
          <button class="btn btn-outline-primary" (click)="invoice(o)" [disabled]="busy()">Download invoice</button>
        }
        @if (canCancel()) {
          <button class="btn btn-outline-danger" (click)="cancel()" [disabled]="busy()">Cancel order</button>
        }
      </div>
    } @else if (!error()) {
      <p class="text-body-secondary mt-3">Loading…</p>
    }
  `,
})
export class OrderDetail implements OnDestroy {
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);
  private id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  private timer?: ReturnType<typeof setInterval>;

  steps = STEPS;
  order = signal<Order | null>(null);
  busy = signal(false);
  error = signal<string | null>((inject(Router).getCurrentNavigation()?.extras.state?.['error'] as string) ?? null);

  canCancel = computed(() => ['Placed', 'PaymentPending', 'OnCredit'].includes(this.order()?.status ?? ''));
  payText = computed(() => {
    const m = this.order()?.paymentMode;
    return m === 'Cash' ? 'cash on delivery' : m === 'Credit' ? 'on your account' : 'online';
  });
  mapUrl = computed<SafeResourceUrl | null>(() => {
    const o = this.order();
    if (o?.driverLat == null || o.driverLng == null) return null;
    const d = 0.01;
    const bbox = [o.driverLng - d, o.driverLat - d, o.driverLng + d, o.driverLat + d].join(',');
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${o.driverLat},${o.driverLng}`);
  });
  googleMaps = computed(() => `https://www.google.com/maps/search/?api=1&query=${this.order()?.driverLat},${this.order()?.driverLng}`);

  constructor() {
    this.refresh();
    this.timer = setInterval(() => {
      if (this.order() && isActive(this.order()!.status)) this.refresh();
    }, 10_000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async refresh() {
    try {
      this.order.set(await this.api.order(this.id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async pay() {
    this.busy.set(true);
    try {
      window.location.href = (await this.api.paymentLink(this.id)).url;
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
    }
  }

  async cancel() {
    if (!confirm('Cancel this order?')) return;
    this.busy.set(true);
    try {
      this.order.set(await this.api.cancel(this.id));
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async invoice(o: Order) {
    this.busy.set(true);
    try {
      await this.api.downloadInvoice(o.invoiceId!, o.invoiceNo!);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly statusText = STATUS_TEXT;
}
