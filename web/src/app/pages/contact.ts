import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { BUSINESS, telLink, whatsappLink } from '../core/business';
import { EnquiryType } from '../core/models';
import { PageHeader } from '../shared/ui';

const TYPES: { value: EnquiryType; label: string }[] = [
  { value: 'general', label: 'General question' },
  { value: 'bulk_order', label: 'Bulk order' },
  { value: 'event', label: 'Event or function' },
  { value: 'office_supply', label: 'Office or shop supply' },
  { value: 'monthly_supply', label: 'Monthly supply' },
];

@Component({
  selector: 'app-contact',
  imports: [ReactiveFormsModule, PageHeader],
  template: `
    <app-page-header eyebrow="Contact" title="Talk to us"
      intro="Questions, bulk orders, office supply or monthly delivery: send us a message and we will get back to you." />

    <div class="container-page grid gap-10 py-12 lg:grid-cols-3">
      <aside class="space-y-4">
        @if (whatsapp) {
          <a [href]="whatsapp" target="_blank" rel="noopener" class="btn-whatsapp w-full py-3">Chat on WhatsApp</a>
        }
        @if (business.phone) {
          <div class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">Phone</h2>
            <a [href]="tel(business.phone)" class="mt-1 block text-lg font-semibold text-brand-800">{{ business.phone }}</a>
          </div>
        }
        @if (business.email) {
          <div class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">Email</h2>
            <a [href]="'mailto:' + business.email" class="mt-1 block font-semibold break-all text-brand-800">{{ business.email }}</a>
          </div>
        }
        @if (business.address.length) {
          <div class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">Address</h2>
            <address class="mt-1 not-italic">
              @for (line of business.address; track $index) {<span class="block">{{ line }}</span>}
            </address>
          </div>
        }
        <div class="card p-5">
          <h2 class="text-sm font-semibold text-slate-500">Hours</h2>
          @for (h of business.hours; track h) {<p class="mt-1">{{ h }}</p>}
        </div>
      </aside>

      <section class="card p-6 lg:col-span-2" aria-labelledby="form-title">
        @if (sent()) {
          <div class="py-10 text-center" role="status">
            <h2 id="form-title" class="text-2xl">Thank you, we have your message</h2>
            <p class="mt-2 text-slate-600">We will reply on the phone number or email you gave us.</p>
            <button type="button" class="btn-secondary mt-6" (click)="reset()">Send another message</button>
          </div>
        } @else {
          <h2 id="form-title" class="text-xl">Send an enquiry</h2>
          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 grid gap-5 sm:grid-cols-2" novalidate>
            <div class="sm:col-span-2">
              <label for="type" class="label">What is it about?</label>
              <select id="type" formControlName="enquiry_type" class="input">
                @for (t of types; track t.value) {<option [value]="t.value">{{ t.label }}</option>}
              </select>
            </div>
            <div>
              <label for="name" class="label">Your name *</label>
              <input id="name" formControlName="name" class="input" autocomplete="name" [attr.aria-invalid]="invalid('name')" aria-describedby="name-error" />
              @if (invalid('name')) {<p id="name-error" class="field-error">Please enter your name.</p>}
            </div>
            <div>
              <label for="phone" class="label">Phone *</label>
              <input id="phone" formControlName="phone" class="input" type="tel" autocomplete="tel" inputmode="tel"
                     [attr.aria-invalid]="invalid('phone')" aria-describedby="phone-error" />
              @if (invalid('phone')) {<p id="phone-error" class="field-error">Enter a valid 10-digit mobile number.</p>}
            </div>
            <div>
              <label for="email" class="label">Email</label>
              <input id="email" formControlName="email" class="input" type="email" autocomplete="email" [attr.aria-invalid]="invalid('email')" aria-describedby="email-error" />
              @if (invalid('email')) {<p id="email-error" class="field-error">Enter a valid email address.</p>}
            </div>
            <div>
              <label for="company" class="label">Company or organisation</label>
              <input id="company" formControlName="company" class="input" autocomplete="organization" />
            </div>
            @if (isBulk()) {
              <div>
                <label for="quantity" class="label">Quantity needed</label>
                <input id="quantity" formControlName="quantity_note" class="input" placeholder="e.g. 50 cans a month, 200 bottles" />
              </div>
              <div>
                <label for="date" class="label">Preferred date</label>
                <input id="date" formControlName="preferred_date" class="input" type="date" [min]="today" />
              </div>
            }
            <div class="sm:col-span-2">
              <label for="message" class="label">Message *</label>
              <textarea id="message" formControlName="message" rows="5" class="input" [attr.aria-invalid]="invalid('message')" aria-describedby="message-error"></textarea>
              @if (invalid('message')) {<p id="message-error" class="field-error">Please write a short message (at least 5 characters).</p>}
            </div>
            <!-- Hidden from people; spam bots fill it in. -->
            <div class="hidden" aria-hidden="true">
              <label for="website">Website</label>
              <input id="website" formControlName="website" tabindex="-1" autocomplete="off" />
            </div>
            @if (error()) {
              <p class="rounded-xl bg-red-50 p-3 text-red-800 sm:col-span-2" role="alert">{{ error() }}</p>
            }
            <div class="sm:col-span-2">
              <button type="submit" class="btn-primary px-6" [disabled]="sending()">{{ sending() ? 'Sending…' : 'Send message' }}</button>
            </div>
          </form>
        }
      </section>
    </div>
  `,
})
export class Contact implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly business = BUSINESS;
  protected readonly whatsapp = whatsappLink();
  protected readonly tel = telLink;
  protected readonly types = TYPES;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    enquiry_type: ['general' as EnquiryType],
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    phone: ['', [Validators.required, Validators.pattern(/^\+?[0-9 -]{10,18}$/)]],
    email: ['', [Validators.email, Validators.maxLength(254)]],
    company: ['', Validators.maxLength(100)],
    quantity_note: ['', Validators.maxLength(200)],
    preferred_date: [''],
    message: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(2000)]],
    website: [''],
  });

  ngOnInit() {
    const type = this.route.snapshot.queryParamMap.get('type') as EnquiryType | null;
    if (type && TYPES.some((t) => t.value === type)) this.form.controls.enquiry_type.setValue(type);
  }

  protected isBulk() {
    return this.form.controls.enquiry_type.value !== 'general';
  }

  protected invalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty) ? true : null;
  }

  protected async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.sending.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      await this.api.submitEnquiry({
        ...v,
        email: v.email || null,
        company: v.company || null,
        quantity_note: this.isBulk() ? v.quantity_note || null : null,
        preferred_date: this.isBulk() ? v.preferred_date || null : null,
      });
      this.sent.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }

  protected reset() {
    const type = this.form.controls.enquiry_type.value;
    this.form.reset({ enquiry_type: type });
    this.sent.set(false);
  }
}
