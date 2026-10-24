import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { BUSINESS } from '../core/business';
import { PincodeCheck, Slot } from '../core/models';
import { RupeesPipe } from '../shared/rupees.pipe';
import { PageHeader } from '../shared/ui';

@Component({
  selector: 'app-delivery',
  imports: [FormsModule, RouterLink, RupeesPipe, PageHeader],
  template: `
    <app-page-header eyebrow="Delivery" title="Delivery areas and slots"
      intro="Check whether we deliver to your pincode, see the delivery charge for your area, and read how delivery works." />

    <div class="container-page grid gap-10 py-12 lg:grid-cols-2">
      <section aria-labelledby="check-title" class="card p-6">
        <h2 id="check-title" class="text-xl">Do we deliver to you?</h2>
        <form class="mt-4 flex flex-wrap items-end gap-3" (ngSubmit)="check()">
          <div class="min-w-40 flex-1">
            <label for="pincode" class="label">Your pincode</label>
            <input id="pincode" name="pincode" class="input" inputmode="numeric" maxlength="6" autocomplete="postal-code"
                   placeholder="6-digit pincode" [(ngModel)]="pincode" [attr.aria-invalid]="!!pinError()"
                   aria-describedby="pincode-result" />
          </div>
          <button type="submit" class="btn-primary h-11" [disabled]="checking()">{{ checking() ? 'Checking…' : 'Check' }}</button>
        </form>
        <div id="pincode-result" class="mt-4" aria-live="polite">
          @if (pinError()) {
            <p class="field-error">{{ pinError() }}</p>
          } @else if (result(); as r) {
            @if (r.served) {
              <div class="rounded-xl bg-green-50 p-4 text-green-900">
                <p class="font-semibold">Yes, we deliver to {{ r.pincode }}.</p>
                <ul class="mt-2 space-y-1 text-sm">
                  <li>Delivery charge: {{ r.delivery_charge ? (r.delivery_charge | rupees) : 'Free' }}</li>
                  @if (r.free_delivery_min) {
                    <li>Free delivery on orders of {{ r.free_delivery_min | rupees }} or more</li>
                  }
                  @if (r.min_order_amount) {
                    <li>Minimum order: {{ r.min_order_amount | rupees }}</li>
                  }
                </ul>
                <a routerLink="/products" class="btn-primary mt-4">Order now</a>
              </div>
            } @else {
              <div class="rounded-xl bg-amber-50 p-4 text-amber-900">
                <p class="font-semibold">We don't deliver to {{ r.pincode }} yet.</p>
                <p class="mt-1 text-sm">For bulk or regular orders we may still be able to help.</p>
                <a routerLink="/contact" [queryParams]="{ type: 'general' }" class="btn-secondary mt-3">Contact us</a>
              </div>
            }
          }
        </div>

        @if (business.serviceAreas.length) {
          <h3 class="mt-8 text-base">Areas we serve</h3>
          <p class="mt-2 text-slate-600">{{ business.serviceAreas.join(', ') }}</p>
        }
      </section>

      <section aria-labelledby="slots-title">
        <h2 id="slots-title" class="text-xl">Delivery slots</h2>
        <p class="mt-2 text-slate-600">Choose a slot when you check out. Orders must be placed a little before the slot starts.</p>
        @if (slots().length) {
          <ul class="mt-4 grid gap-3 sm:grid-cols-3">
            @for (s of slots(); track s.slot_id) {
              <li class="card p-4 text-center">
                <p class="font-semibold text-brand-900">{{ s.label }}</p>
                <p class="text-sm text-slate-600">{{ time(s.start_time) }} – {{ time(s.end_time) }}</p>
              </li>
            }
          </ul>
        }
        <ul class="mt-4 space-y-1 text-sm text-slate-600">
          @for (h of business.hours; track h) {
            <li>{{ h }}</li>
          }
        </ul>
      </section>

      <section aria-labelledby="how-title" class="lg:col-span-2">
        <h2 id="how-title" class="text-xl">How delivery works</h2>
        <ol class="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          @for (step of instructions; track step.title; let i = $index) {
            <li class="card p-5">
              <p class="text-sm font-semibold text-aqua-700">Step {{ i + 1 }}</p>
              <h3 class="mt-1 text-base">{{ step.title }}</h3>
              <p class="mt-1 text-sm text-slate-600">{{ step.text }}</p>
            </li>
          }
        </ol>
      </section>
    </div>
  `,
})
export class Delivery implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly business = BUSINESS;

  protected pincode = '';
  protected readonly checking = signal(false);
  protected readonly result = signal<PincodeCheck | null>(null);
  protected readonly pinError = signal<string | null>(null);
  protected readonly slots = signal<Slot[]>([]);

  protected readonly instructions = [
    { title: 'Order and pick a slot', text: 'Choose your products, delivery address, date and time slot.' },
    { title: 'Keep empty cans ready', text: 'For 20-litre cans, keep your empty cans ready to hand over when we deliver full ones.' },
    { title: 'Someone to receive', text: 'Please make sure someone is available at the address during your slot.' },
    { title: 'Pay and receive', text: 'Pay online at checkout, or in cash on delivery. Track status in your account.' },
  ];

  async ngOnInit() {
    try {
      const settings = await this.api.settings();
      // Slot windows are the same every day; show the ones for a weekday so all of them appear.
      const day = new Date(settings.today + 'T00:00:00');
      day.setDate(day.getDate() + ((8 - day.getDay()) % 7 || 7)); // next Monday
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      this.slots.set(await this.api.slots(iso));
    } catch {
      // Slot list is informational; hide it if unavailable.
    }
  }

  protected async check() {
    const pin = this.pincode.trim();
    this.result.set(null);
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      this.pinError.set('Enter a valid 6-digit pincode.');
      return;
    }
    this.pinError.set(null);
    this.checking.set(true);
    try {
      this.result.set(await this.api.checkPincode(pin));
    } catch (e) {
      this.pinError.set(errorMessage(e));
    } finally {
      this.checking.set(false);
    }
  }

  protected time(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
}
