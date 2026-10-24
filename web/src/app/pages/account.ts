import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Address, CustomerType, Profile } from '../core/models';
import { AddressForm } from '../shared/address-form';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, PageHeader, Spinner } from '../shared/ui';

@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, RouterLink, AddressForm, RupeesPipe, PageHeader, Spinner, ErrorBox],
  template: `
    <app-page-header title="My account" [intro]="profile()?.email ?? ''">
      <div class="mt-6 flex flex-wrap gap-3">
        <a routerLink="/orders" class="btn-primary">My orders</a>
        @if (profile()?.role === 'staff' || profile()?.role === 'admin') {
          <a routerLink="/admin" class="btn-secondary">Admin dashboard</a>
        }
        <button type="button" class="btn-secondary" (click)="signOut()">Sign out</button>
      </div>
    </app-page-header>

    <div class="container-page py-10">
      @if (loading()) {
        <app-spinner />
      } @else if (error()) {
        <app-error [message]="error()!" [retry]="load" />
      } @else {
        <div class="grid gap-8 lg:grid-cols-3">
          <section class="card p-6" aria-labelledby="profile-title">
            <h2 id="profile-title" class="text-lg">Your details</h2>
            <form [formGroup]="form" (ngSubmit)="saveProfile()" class="mt-4 space-y-4" novalidate>
              <div>
                <label for="full_name" class="label">Full name</label>
                <input id="full_name" formControlName="full_name" class="input" autocomplete="name" />
                @if (form.controls.full_name.invalid && form.controls.full_name.touched) {<p class="field-error">Enter your name.</p>}
              </div>
              <div>
                <label for="phone" class="label">Mobile number</label>
                <input id="phone" formControlName="phone" class="input" type="tel" inputmode="tel" autocomplete="tel" />
                @if (form.controls.phone.invalid && form.controls.phone.touched) {<p class="field-error">Enter a valid 10-digit mobile number.</p>}
              </div>
              <div>
                <label for="customer_type" class="label">I am ordering for</label>
                <select id="customer_type" formControlName="customer_type" class="input">
                  <option value="home">Home</option><option value="office">Office</option><option value="shop">Shop</option>
                  <option value="hotel">Hotel or restaurant</option><option value="other">Other</option>
                </select>
              </div>
              @if (profileMsg()) {<p class="text-sm" [class.text-green-700]="!profileErr()" [class.text-red-700]="profileErr()" role="status">{{ profileMsg() }}</p>}
              <button type="submit" class="btn-primary" [disabled]="savingProfile()">{{ savingProfile() ? 'Saving…' : 'Save details' }}</button>
            </form>

            @if (profile()!.cans_with_deposit > 0) {
              <div class="mt-6 rounded-xl bg-aqua-50 p-4 text-sm">
                <p class="font-semibold text-brand-900">Cans with you: {{ profile()!.cans_with_deposit }}</p>
                <p class="mt-1 text-slate-600">Refundable deposit held: {{ profile()!.deposit_balance | rupees }}. Return the cans to get it back.</p>
              </div>
            }
          </section>

          <section class="lg:col-span-2" aria-labelledby="addresses-title">
            <div class="flex items-center justify-between gap-4">
              <h2 id="addresses-title" class="text-lg">Delivery addresses</h2>
              @if (editing() === null) {
                <button type="button" class="btn-secondary" (click)="editing.set('new')">Add address</button>
              }
            </div>

            @if (editing() === 'new') {
              <div class="card mt-4 p-5">
                <h3 class="mb-4 text-base">New address</h3>
                <app-address-form [defaults]="{ contact_name: profile()!.full_name ?? '', contact_phone: profile()!.phone ?? '' }"
                                  (saved)="addressSaved()" (cancelled)="editing.set(null)" />
              </div>
            }

            @if (addresses().length === 0 && editing() !== 'new') {
              <p class="card mt-4 p-6 text-slate-600">No saved addresses yet. Add one to order faster.</p>
            }

            <ul class="mt-4 grid gap-4 sm:grid-cols-2">
              @for (a of addresses(); track a.id) {
                <li class="card p-5" [class.sm:col-span-2]="editing() === a.id">
                  @if (editing() === a.id) {
                    <app-address-form [address]="a" (saved)="addressSaved()" (cancelled)="editing.set(null)" />
                  } @else {
                    <div class="flex items-start justify-between gap-2">
                      <p class="font-semibold text-brand-900">{{ a.label }}</p>
                      @if (a.is_default) {<span class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Default</span>}
                    </div>
                    <address class="mt-2 text-sm text-slate-600 not-italic">
                      {{ a.contact_name }} · {{ a.contact_phone }}<br />
                      {{ a.line1 }}@if (a.line2) {, {{ a.line2 }}}<br />
                      @if (a.landmark) {Near {{ a.landmark }}<br />}
                      {{ a.city }} – {{ a.pincode }}
                    </address>
                    <div class="mt-4 flex flex-wrap gap-4 text-sm font-medium">
                      <button type="button" class="text-brand-700 hover:underline" (click)="editing.set(a.id)">Edit</button>
                      @if (!a.is_default) {
                        <button type="button" class="text-brand-700 hover:underline" (click)="makeDefault(a)">Make default</button>
                      }
                      <button type="button" class="text-red-600 hover:underline" (click)="remove(a)">Delete</button>
                    </div>
                  }
                </li>
              }
            </ul>
            @if (addressError()) {<p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ addressError() }}</p>}
          </section>
        </div>
      }
    </div>
  `,
})
export class Account implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly profile = signal<Profile | null>(null);
  protected readonly addresses = signal<Address[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null); // 'new', an address id, or null
  protected readonly addressError = signal<string | null>(null);
  protected readonly savingProfile = signal(false);
  protected readonly profileMsg = signal<string | null>(null);
  protected readonly profileErr = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    full_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    phone: ['', Validators.pattern(/^\+?[0-9]{10,15}$/)],
    customer_type: ['home' as CustomerType],
  });

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [p, a] = await Promise.all([this.api.me(), this.api.addresses()]);
      this.profile.set(p);
      this.addresses.set(a);
      this.form.reset({ full_name: p.full_name ?? '', phone: p.phone ?? '', customer_type: p.customer_type });
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected async saveProfile() {
    const phone = this.form.controls.phone;
    phone.setValue(phone.value.replace(/[\s-]/g, ''));
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.savingProfile.set(true);
    this.profileMsg.set(null);
    try {
      const v = this.form.getRawValue();
      this.profile.set(await this.api.updateMe({ full_name: v.full_name.trim(), phone: v.phone || null, customer_type: v.customer_type }));
      this.profileErr.set(false);
      this.profileMsg.set('Saved.');
    } catch (e) {
      this.profileErr.set(true);
      this.profileMsg.set(errorMessage(e));
    } finally {
      this.savingProfile.set(false);
    }
  }

  protected async addressSaved() {
    this.editing.set(null);
    this.addresses.set(await this.api.addresses());
  }

  protected async makeDefault(a: Address) {
    await this.run(() => this.api.makeDefaultAddress(a.id));
  }

  protected async remove(a: Address) {
    if (!confirm(`Delete the address "${a.label}, ${a.line1}"?`)) return;
    await this.run(() => this.api.deleteAddress(a.id));
  }

  private async run(action: () => Promise<unknown>) {
    this.addressError.set(null);
    try {
      await action();
      this.addresses.set(await this.api.addresses());
    } catch (e) {
      this.addressError.set(errorMessage(e));
    }
  }

  protected async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
