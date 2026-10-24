import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { Address, AddressInput } from '../core/models';

/** Add or edit a delivery address. Emits the saved address. */
@Component({
  selector: 'app-address-form',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="grid gap-4 sm:grid-cols-2" novalidate>
      <div>
        <label [for]="id('label')" class="label">Label</label>
        <select [id]="id('label')" formControlName="label" class="input">
          <option>Home</option><option>Office</option><option>Shop</option><option>Other</option>
        </select>
      </div>
      <div>
        <label [for]="id('pincode')" class="label">Pincode *</label>
        <input [id]="id('pincode')" formControlName="pincode" class="input" inputmode="numeric" maxlength="6" autocomplete="postal-code" [attr.aria-invalid]="bad('pincode')" />
        @if (bad('pincode')) {<p class="field-error">Enter a valid 6-digit pincode.</p>}
      </div>
      <div>
        <label [for]="id('contact_name')" class="label">Contact name *</label>
        <input [id]="id('contact_name')" formControlName="contact_name" class="input" autocomplete="name" [attr.aria-invalid]="bad('contact_name')" />
        @if (bad('contact_name')) {<p class="field-error">Enter who will receive the delivery.</p>}
      </div>
      <div>
        <label [for]="id('contact_phone')" class="label">Contact phone *</label>
        <input [id]="id('contact_phone')" formControlName="contact_phone" class="input" type="tel" inputmode="tel" autocomplete="tel" [attr.aria-invalid]="bad('contact_phone')" />
        @if (bad('contact_phone')) {<p class="field-error">Enter a valid 10-digit mobile number.</p>}
      </div>
      <div class="sm:col-span-2">
        <label [for]="id('line1')" class="label">House / flat, building and street *</label>
        <input [id]="id('line1')" formControlName="line1" class="input" autocomplete="address-line1" [attr.aria-invalid]="bad('line1')" />
        @if (bad('line1')) {<p class="field-error">Enter the house or flat number and street.</p>}
      </div>
      <div>
        <label [for]="id('line2')" class="label">Area / locality</label>
        <input [id]="id('line2')" formControlName="line2" class="input" autocomplete="address-line2" />
      </div>
      <div>
        <label [for]="id('landmark')" class="label">Landmark</label>
        <input [id]="id('landmark')" formControlName="landmark" class="input" />
      </div>
      <div>
        <label [for]="id('city')" class="label">City *</label>
        <input [id]="id('city')" formControlName="city" class="input" autocomplete="address-level2" [attr.aria-invalid]="bad('city')" />
        @if (bad('city')) {<p class="field-error">Enter the city.</p>}
      </div>
      <label class="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" formControlName="is_default" class="h-4 w-4 rounded border-slate-300 text-brand-600" />
        Use as my default address
      </label>
      @if (error()) {<p class="rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:col-span-2" role="alert">{{ error() }}</p>}
      <div class="flex gap-3 sm:col-span-2">
        <button type="submit" class="btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save address' }}</button>
        <button type="button" class="btn-secondary" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class AddressForm implements OnInit {
  /** Address to edit; omit to add a new one. */
  readonly address = input<Address | null>(null);
  /** Pre-fill for a new address (e.g. the customer's name and phone). */
  readonly defaults = input<Partial<AddressInput>>({});
  readonly saved = output<Address>();
  readonly cancelled = output<void>();

  private readonly api = inject(ApiService);
  private static next = 0;
  private readonly uid = 'addr' + AddressForm.next++;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    label: ['Home'],
    contact_name: ['', [Validators.required, Validators.maxLength(100)]],
    contact_phone: ['', [Validators.required, Validators.pattern(/^\+?[0-9]{10,15}$/)]],
    line1: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    line2: ['', Validators.maxLength(200)],
    landmark: ['', Validators.maxLength(100)],
    city: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    pincode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    is_default: [false],
  });

  ngOnInit() {
    const a = this.address();
    if (a) this.form.patchValue({ ...a, line2: a.line2 ?? '', landmark: a.landmark ?? '' });
    else this.form.patchValue(this.defaults() as never);
  }

  protected id = (name: string) => `${this.uid}-${name}`;
  protected bad = (name: keyof typeof this.form.controls) => {
    const c: AbstractControl = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty) ? true : null;
  };

  protected async save() {
    // Phone numbers are often typed with spaces or dashes.
    const phone = this.form.controls.contact_phone;
    phone.setValue(phone.value.replace(/[\s-]/g, ''));
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const input: AddressInput = { ...v, line2: v.line2.trim() || null, landmark: v.landmark.trim() || null };
    try {
      const a = this.address();
      this.saved.emit(a ? await this.api.updateAddress(a.id, input) : await this.api.addAddress(input));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
