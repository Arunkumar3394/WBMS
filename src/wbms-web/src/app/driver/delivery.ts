import { CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Order } from '../shared/models';
import { StatusBadge } from '../shared/status-badge';

const SEND_EVERY_MS = 15_000;

/**
 * One delivery: start it (the customer gets the code by SMS), share the phone's location while this page is open,
 * then enter the customer's code, cans and cash to finish.
 */
@Component({
  selector: 'app-delivery',
  imports: [FormsModule, RouterLink, CurrencyPipe, StatusBadge],
  template: `
    <a routerLink="/driver" class="small">← All deliveries</a>
    @if (error()) { <div class="alert alert-danger py-2 mt-2">{{ error() }}</div> }
    @if (order(); as o) {
      <div class="d-flex justify-content-between align-items-start mt-2 mb-2">
        <h1 class="h5 mb-0">{{ o.customerName }}</h1>
        <app-status [status]="o.status" [staff]="true" />
      </div>
      <p class="mb-2">{{ o.address }}</p>
      <div class="d-flex gap-2 mb-3">
        <a class="btn btn-outline-primary flex-fill" [href]="'tel:' + o.customerPhone">Call</a>
        <a class="btn btn-outline-primary flex-fill" [href]="navigateUrl()" target="_blank" rel="noopener">Directions</a>
      </div>
      <ul class="list-group mb-3">
        @for (i of o.items; track i.productId) { <li class="list-group-item d-flex justify-content-between"><span>{{ i.qty }} × {{ i.product }}</span></li> }
        <li class="list-group-item d-flex justify-content-between fw-semibold">
          <span>{{ o.paymentMode === 'Cash' ? 'Collect cash' : o.paymentMode === 'Credit' ? 'On credit (no cash)' : 'Paid online' }}</span>
          <span>{{ o.total | currency: 'INR' : 'symbol' : '1.0-0' }}</span>
        </li>
      </ul>
      @if (o.notes) { <p class="small">Note: “{{ o.notes }}”</p> }

      @if (o.status === 'Assigned') {
        <button class="btn btn-primary btn-lg w-100" (click)="start()" [disabled]="busy()">Start delivery</button>
        <p class="small text-body-secondary mt-2">The customer gets a 4-digit code by SMS. Keep this page open on the way so they can see where you are.</p>
      }

      @if (o.status === 'OutForDelivery') {
        <div class="alert py-2 small" [class.alert-success]="sharing()" [class.alert-warning]="!sharing()">
          @if (sharing()) { Sharing your location with the customer{{ lastSent() ? ' · sent ' + lastSent() : '' }}. }
          @else { {{ locationProblem() ?? 'Starting location sharing…' }} }
        </div>
        <form class="card card-body" (ngSubmit)="complete()">
          <h2 class="h6">Finish delivery</h2>
          <label class="form-label" for="otp">Customer's 4-digit code</label>
          <input id="otp" class="form-control form-control-lg text-center otp-input mb-3" name="otp" [(ngModel)]="otp"
                 inputmode="numeric" maxlength="4" autocomplete="off" required />
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small" for="full">Full cans given</label>
              <input id="full" type="number" min="0" class="form-control" name="full" [(ngModel)]="fullCans" inputmode="numeric" />
            </div>
            <div class="col-6">
              <label class="form-label small" for="empty">Empty cans taken</label>
              <input id="empty" type="number" min="0" class="form-control" name="empty" [(ngModel)]="emptyCans" inputmode="numeric" />
            </div>
          </div>
          <label class="form-label small" for="cash">Cash received (₹)</label>
          <input id="cash" type="number" min="0" class="form-control mb-3" name="cash" [(ngModel)]="cash" inputmode="decimal" />
          <button class="btn btn-success btn-lg w-100" [disabled]="busy() || otp.length !== 4">Delivered</button>
        </form>
        <button class="btn btn-link w-100 mt-2" (click)="resend()" [disabled]="busy()">Customer didn't get the code? Send again</button>
        @if (info()) { <div class="alert alert-info py-2 small">{{ info() }}</div> }
      }

      @if (o.status === 'Completed') {
        <div class="alert alert-success">Delivered. Invoice {{ o.invoiceNo }} has been created.</div>
        <a routerLink="/driver" class="btn btn-primary w-100">Next delivery</a>
      }
    } @else if (!error()) {
      <p class="text-body-secondary mt-3">Loading…</p>
    }
  `,
})
export class Delivery implements OnDestroy {
  private api = inject(ApiService);
  private id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  private watchId: number | null = null;
  private lastSentAt = 0;

  order = signal<Order | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  info = signal<string | null>(null);
  sharing = signal(false);
  locationProblem = signal<string | null>(null);
  lastSent = signal<string | null>(null);
  otp = '';
  fullCans = 0;
  emptyCans = 0;
  cash = 0;

  navigateUrl = computed(() => {
    const o = this.order();
    if (!o) return '';
    const dest = o.addressLat != null && o.addressLng != null ? `${o.addressLat},${o.addressLng}` : encodeURIComponent(o.address);
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  });

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    this.stopSharing();
  }

  async load() {
    try {
      this.show(await this.api.order(this.id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private show(o: Order) {
    this.order.set(o);
    if (o.status === 'OutForDelivery') {
      if (!this.otp) {
        this.fullCans = o.items.reduce((n, i) => n + i.qty, 0);
        this.cash = o.paymentMode === 'Cash' ? o.total : 0;
      }
      this.startSharing();
    } else {
      this.stopSharing();
    }
  }

  private async act(fn: () => Promise<Order | void>) {
    this.error.set(null);
    this.info.set(null);
    this.busy.set(true);
    try {
      const o = await fn();
      if (o) this.show(o);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  start() { return this.act(() => this.api.start(this.id)); }

  resend() {
    return this.act(async () => {
      await this.api.resendOtp(this.id);
      this.info.set('A new code has been sent. The old code no longer works.');
    });
  }

  complete() {
    return this.act(() => this.api.complete(this.id, {
      otp: this.otp, fullCansDelivered: this.fullCans || 0, emptyCansCollected: this.emptyCans || 0, cashCollected: this.cash || 0,
    }));
  }

  /** Browsers only share location on https:// pages (or localhost) and only while this page is open. */
  private startSharing() {
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) {
      this.locationProblem.set("This phone's browser can't share location.");
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.sharing.set(true);
        this.locationProblem.set(null);
        const now = Date.now();
        if (now - this.lastSentAt < SEND_EVERY_MS) return;
        this.lastSentAt = now;
        this.api.sendLocation(this.id, pos.coords.latitude, pos.coords.longitude).then(
          () => this.lastSent.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
          () => { this.lastSentAt = 0; }, // try again with the next position
        );
      },
      (err) => {
        this.sharing.set(false);
        this.locationProblem.set(err.code === err.PERMISSION_DENIED
          ? 'Location is blocked. Allow location for this site in your browser settings so the customer can see you coming.'
          : "Can't get your location right now. You can still finish the delivery.");
      },
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
  }

  private stopSharing() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.sharing.set(false);
  }
}
