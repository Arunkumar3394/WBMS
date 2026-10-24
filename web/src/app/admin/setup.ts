import { Component, Directive, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.service';
import { formatDay } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, AdminCategory, AdminSlot, AdminTestimonial, BusinessSettings, CategoryInput, SlotInput, TestimonialInput, Zone, ZoneInput } from './admin-api';
import { AdminTitle, Flash } from './admin-ui';

/** Shared list-and-form behaviour for the small setup pages. */
@Directive()
abstract class EditableList<T extends { id: number }, I> implements OnInit {
  protected readonly items = signal<T[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | 'new' | null>(null);
  protected readonly saving = signal(false);
  protected readonly msg = signal<string | null>(null);
  protected readonly msgErr = signal(false);
  protected draft!: I;

  protected abstract fetch(): Promise<T[]>;
  protected abstract persist(id: number | null, input: I): Promise<T>;
  protected abstract blank(): I;
  protected abstract toInput(item: T): I;
  /** Returns an error message, or null when the draft is fine. */
  protected check(_input: I): string | null {
    return null;
  }

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      this.items.set(await this.fetch());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected edit(item: T | null) {
    this.msg.set(null);
    this.draft = item ? this.toInput(item) : this.blank();
    this.editingId.set(item ? item.id : 'new');
  }

  protected async save() {
    const problem = this.check(this.draft);
    if (problem) {
      this.msgErr.set(true);
      this.msg.set(problem);
      return;
    }
    const id = this.editingId();
    this.saving.set(true);
    try {
      const saved = await this.persist(id === 'new' ? null : id, this.draft);
      this.items.update((xs) => (id === 'new' ? [...xs, saved] : xs.map((x) => (x.id === saved.id ? saved : x))));
      this.editingId.set(null);
      this.msgErr.set(false);
      this.msg.set('Saved.');
    } catch (e) {
      this.msgErr.set(true);
      this.msg.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}

// ---------------------------------------------------------------- Categories
@Component({
  selector: 'app-admin-categories',
  imports: [FormsModule, AdminTitle, Flash, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Categories">
      @if (editingId() === null) {<button type="button" class="btn-primary" (click)="edit(null)">Add category</button>}
    </app-admin-title>
    <div class="mb-4"><app-flash [message]="msg()" [error]="msgErr()" /></div>
    @if (editingId() !== null) {
      <form class="card mb-6 grid gap-4 p-5 sm:grid-cols-2" (ngSubmit)="save()">
        <div><label for="c-name" class="label">Name *</label><input id="c-name" name="name" class="input" required [(ngModel)]="draft.name" /></div>
        <div><label for="c-slug" class="label">Web address name *</label><input id="c-slug" name="slug" class="input" required [(ngModel)]="draft.slug" placeholder="water-cans" /></div>
        <div class="sm:col-span-2"><label for="c-desc" class="label">Description</label><input id="c-desc" name="desc" class="input" maxlength="500" [(ngModel)]="draft.description" /></div>
        <div><label for="c-sort" class="label">Order</label><input id="c-sort" name="sort" type="number" class="input" [(ngModel)]="draft.sort_order" /></div>
        <label class="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="draft.is_active" /> Shown on the site</label>
        <div class="flex gap-3 sm:col-span-2">
          <button type="submit" class="btn-primary" [disabled]="saving()">Save</button>
          <button type="button" class="btn-secondary" (click)="editingId.set(null)">Cancel</button>
        </div>
      </form>
    }
    @if (loading()) {<app-spinner />} @else if (error()) {<app-error [message]="error()!" [retry]="load" />} @else {
      <ul class="card divide-y divide-slate-100">
        @for (c of items(); track c.id) {
          <li class="flex flex-wrap items-center justify-between gap-3 p-4">
            <div><p class="font-semibold text-brand-900">{{ c.name }} @if (!c.is_active) {<span class="text-xs font-normal text-slate-500">(hidden)</span>}</p>
              <p class="text-sm text-slate-500">/{{ c.slug }} · {{ c.description }}</p></div>
            <button type="button" class="text-sm font-medium text-brand-700 hover:underline" (click)="edit(c)">Edit</button>
          </li>
        }
      </ul>
    }
  `,
})
export class AdminCategories extends EditableList<AdminCategory, CategoryInput> {
  private readonly api = inject(AdminApi);
  protected fetch = () => this.api.categories();
  protected persist = (id: number | null, c: CategoryInput) =>
    this.api.saveCategory(id, { ...c, slug: c.slug.trim(), name: c.name.trim(), description: c.description?.trim() || null, sort_order: Number(c.sort_order) || 0 });
  protected blank = (): CategoryInput => ({ slug: '', name: '', description: '', sort_order: 0, is_active: true });
  protected toInput = ({ id: _id, ...c }: AdminCategory): CategoryInput => ({ ...c, description: c.description ?? '' });
  protected override check(c: CategoryInput) {
    if (c.name.trim().length < 2) return 'Enter a name.';
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug.trim()) ? null : 'Web address name: lowercase letters, numbers and dashes only.';
  }
}

// ---------------------------------------------------------------- Delivery zones and slots
type ZoneDraft = Omit<ZoneInput, 'pincodes'> & { pincodes: string };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'app-admin-zones',
  imports: [FormsModule, RupeesPipe, Flash, Spinner, ErrorBox],
  template: `
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="text-lg">Delivery zones</h2>
      @if (editingId() === null) {<button type="button" class="btn-secondary" (click)="edit(null)">Add zone</button>}
    </div>
    <p class="mb-3 text-sm text-slate-500">Customers can order only to pincodes listed in an active zone.</p>
    <div class="mb-3"><app-flash [message]="msg()" [error]="msgErr()" /></div>
    @if (editingId() !== null) {
      <form class="card mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" (ngSubmit)="save()">
        <div class="sm:col-span-2"><label for="z-name" class="label">Zone name *</label><input id="z-name" name="name" class="input" [(ngModel)]="draft.name" /></div>
        <div><label for="z-charge" class="label">Delivery charge (₹)</label><input id="z-charge" name="charge" type="number" min="0" step="0.01" class="input" [(ngModel)]="draft.delivery_charge" /></div>
        <div><label for="z-free" class="label">Free delivery from (₹)</label><input id="z-free" name="free" type="number" min="0" step="0.01" class="input" [(ngModel)]="draft.free_delivery_min" placeholder="Never" /></div>
        <div class="sm:col-span-2 lg:col-span-3"><label for="z-pins" class="label">Pincodes *</label>
          <textarea id="z-pins" name="pins" rows="2" class="input" [(ngModel)]="draft.pincodes" placeholder="600001, 600002, 600003"></textarea>
          <p class="mt-1 text-xs text-slate-500">Separate with commas, spaces or new lines.</p></div>
        <div><label for="z-min" class="label">Minimum order (₹)</label><input id="z-min" name="min" type="number" min="0" step="0.01" class="input" [(ngModel)]="draft.min_order_amount" /></div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="draft.is_active" /> Active</label>
        <div class="flex gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" class="btn-primary" [disabled]="saving()">Save zone</button>
          <button type="button" class="btn-secondary" (click)="editingId.set(null)">Cancel</button>
        </div>
      </form>
    }
    @if (loading()) {<app-spinner />} @else if (error()) {<app-error [message]="error()!" [retry]="load" />} @else {
      <ul class="space-y-3">
        @for (z of items(); track z.id) {
          <li class="card flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <p class="font-semibold text-brand-900">{{ z.name }} @if (!z.is_active) {<span class="text-xs font-normal text-slate-500">(off)</span>}</p>
              <p class="text-sm">Delivery {{ z.delivery_charge > 0 ? (z.delivery_charge | rupees) : 'free' }}
                @if (z.free_delivery_min) {· free from {{ z.free_delivery_min | rupees }}} · minimum order {{ z.min_order_amount | rupees }}</p>
              <p class="mt-1 text-xs text-slate-500">{{ z.pincodes.join(', ') }}</p>
            </div>
            <button type="button" class="text-sm font-medium text-brand-700 hover:underline" (click)="edit(z)">Edit</button>
          </li>
        } @empty {<li class="card p-4 text-sm text-slate-500">No zones yet: nobody can order online.</li>}
      </ul>
    }
  `,
})
export class AdminZones extends EditableList<Zone, ZoneDraft> {
  private readonly api = inject(AdminApi);
  protected fetch = () => this.api.zones();
  protected persist = (id: number | null, d: ZoneDraft) =>
    this.api.saveZone(id, {
      ...d, name: d.name.trim(), pincodes: pins(d.pincodes), delivery_charge: Number(d.delivery_charge) || 0,
      free_delivery_min: d.free_delivery_min === null || String(d.free_delivery_min) === '' ? null : Number(d.free_delivery_min),
      min_order_amount: Number(d.min_order_amount) || 0,
    });
  protected blank = (): ZoneDraft => ({ name: '', pincodes: '', delivery_charge: 0, free_delivery_min: null, min_order_amount: 0, is_active: true });
  protected toInput = ({ id: _id, ...z }: Zone): ZoneDraft => ({ ...z, pincodes: z.pincodes.join(', ') });
  protected override check(d: ZoneDraft) {
    if (d.name.trim().length < 2) return 'Enter a zone name.';
    const list = pins(d.pincodes);
    if (list.length === 0) return 'Enter at least one pincode.';
    const bad = list.filter((p) => !/^[1-9][0-9]{5}$/.test(p));
    return bad.length ? `These are not valid 6-digit pincodes: ${bad.join(', ')}` : null;
  }
}

function pins(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean))];
}

@Component({
  selector: 'app-admin-slots',
  imports: [FormsModule, Flash, Spinner, ErrorBox],
  template: `
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="text-lg">Delivery slots</h2>
      @if (editingId() === null) {<button type="button" class="btn-secondary" (click)="edit(null)">Add slot</button>}
    </div>
    <div class="mb-3"><app-flash [message]="msg()" [error]="msgErr()" /></div>
    @if (editingId() !== null) {
      <form class="card mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" (ngSubmit)="save()">
        <div><label for="s-label" class="label">Name *</label><input id="s-label" name="label" class="input" [(ngModel)]="draft.label" placeholder="Morning" /></div>
        <div><label for="s-start" class="label">Starts</label><input id="s-start" name="start" type="time" class="input" [(ngModel)]="draft.start_time" /></div>
        <div><label for="s-end" class="label">Ends</label><input id="s-end" name="end" type="time" class="input" [(ngModel)]="draft.end_time" /></div>
        <div><label for="s-cap" class="label">Orders per slot</label><input id="s-cap" name="cap" type="number" min="1" class="input" [(ngModel)]="draft.capacity" /></div>
        <div><label for="s-cut" class="label">Stop booking (minutes before start)</label><input id="s-cut" name="cut" type="number" min="0" class="input" [(ngModel)]="draft.cutoff_minutes" /></div>
        <fieldset class="sm:col-span-2 lg:col-span-3">
          <legend class="label">Days</legend>
          <div class="flex flex-wrap gap-3 text-sm">
            @for (d of days; track d; let i = $index) {
              <label class="flex items-center gap-1"><input type="checkbox" class="h-4 w-4" [checked]="draft.days_of_week.includes(i + 1)" (change)="toggleDay(i + 1)" /> {{ d }}</label>
            }
          </div>
        </fieldset>
        <div><label for="s-sort" class="label">Order</label><input id="s-sort" name="sort" type="number" class="input" [(ngModel)]="draft.sort_order" /></div>
        <label class="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="draft.is_active" /> Active</label>
        <div class="flex gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" class="btn-primary" [disabled]="saving()">Save slot</button>
          <button type="button" class="btn-secondary" (click)="editingId.set(null)">Cancel</button>
        </div>
      </form>
    }
    @if (loading()) {<app-spinner />} @else if (error()) {<app-error [message]="error()!" [retry]="load" />} @else {
      <ul class="space-y-3">
        @for (s of items(); track s.id) {
          <li class="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p class="font-semibold text-brand-900">{{ s.label }} · {{ s.start_time }}–{{ s.end_time }} @if (!s.is_active) {<span class="text-xs font-normal text-slate-500">(off)</span>}</p>
              <p class="text-sm text-slate-500">{{ s.capacity }} orders · booking closes {{ s.cutoff_minutes }} min before · {{ dayNames(s.days_of_week) }}</p>
            </div>
            <button type="button" class="text-sm font-medium text-brand-700 hover:underline" (click)="edit(s)">Edit</button>
          </li>
        } @empty {<li class="card p-4 text-sm text-slate-500">No slots yet: nobody can choose a delivery time.</li>}
      </ul>
    }
  `,
})
export class AdminSlots extends EditableList<AdminSlot, SlotInput> {
  private readonly api = inject(AdminApi);
  protected readonly days = DAYS;
  protected fetch = () => this.api.slots();
  protected persist = (id: number | null, s: SlotInput) =>
    this.api.saveSlot(id, { ...s, label: s.label.trim(), capacity: Number(s.capacity), cutoff_minutes: Number(s.cutoff_minutes) || 0, sort_order: Number(s.sort_order) || 0 });
  protected blank = (): SlotInput => ({ label: '', start_time: '07:00', end_time: '10:00', capacity: 20, cutoff_minutes: 120, days_of_week: [1, 2, 3, 4, 5, 6], sort_order: 0, is_active: true });
  protected toInput = ({ id: _id, ...s }: AdminSlot): SlotInput => ({ ...s, days_of_week: [...s.days_of_week] });
  protected override check(s: SlotInput) {
    if (s.label.trim().length < 2) return 'Enter a slot name.';
    if (!s.start_time || !s.end_time || s.end_time <= s.start_time) return 'The slot must end after it starts.';
    if (!(Number(s.capacity) >= 1)) return 'Orders per slot must be at least 1.';
    return s.days_of_week.length ? null : 'Choose at least one day.';
  }
  protected toggleDay(d: number) {
    const list = this.draft.days_of_week;
    this.draft.days_of_week = list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort();
  }
  protected dayNames(ds: number[]) {
    return ds.length === 7 ? 'every day' : ds.map((d) => DAYS[d - 1]).join(', ');
  }
}

@Component({
  selector: 'app-admin-delivery',
  imports: [AdminTitle, AdminZones, AdminSlots],
  template: `
    <app-admin-title title="Delivery" subtitle="Where you deliver, what it costs, and when." />
    <div class="space-y-10">
      <section><app-admin-zones /></section>
      <section><app-admin-slots /></section>
    </div>
  `,
})
export class AdminDelivery {}

// ---------------------------------------------------------------- Settings
@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule, AdminTitle, Flash, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Settings" />
    @if (loading()) {<app-spinner />} @else if (error()) {<app-error [message]="error()!" [retry]="load" />} @else if (s) {
      <form class="card max-w-2xl space-y-6 p-6" (ngSubmit)="save()">
        <fieldset class="space-y-3">
          <legend class="text-base font-semibold text-brand-900">Payment</legend>
          <label class="flex items-start gap-2 text-sm"><input type="checkbox" name="cod" class="mt-0.5 h-4 w-4" [(ngModel)]="s.cod_enabled" />
            <span>Cash / UPI on delivery</span></label>
          <label class="flex items-start gap-2 text-sm"><input type="checkbox" name="online" class="mt-0.5 h-4 w-4" [(ngModel)]="s.online_payment_enabled" />
            <span>Online payment (Razorpay)<br /><span class="text-slate-500">Only offered when the Razorpay keys are set on the server.</span></span></label>
          <div>
            <label for="expiry" class="label">Cancel unpaid online orders after (minutes)</label>
            <input id="expiry" name="expiry" type="number" min="5" max="1440" class="input max-w-40" [(ngModel)]="s.unpaid_order_expiry_minutes" />
          </div>
        </fieldset>
        <fieldset class="space-y-3">
          <legend class="text-base font-semibold text-brand-900">Cans</legend>
          <label class="flex items-start gap-2 text-sm"><input type="checkbox" name="deposit" class="mt-0.5 h-4 w-4" [(ngModel)]="s.deposit_enabled" />
            <span>Charge a refundable deposit for new returnable cans<br /><span class="text-slate-500">The amount per can is set on each product.</span></span></label>
        </fieldset>
        <fieldset class="space-y-3">
          <legend class="text-base font-semibold text-brand-900">Booking</legend>
          <div>
            <label for="adv" class="label">How many days ahead customers can book</label>
            <input id="adv" name="adv" type="number" min="0" max="60" class="input max-w-40" [(ngModel)]="s.max_advance_days" />
          </div>
          <div>
            <label for="closed" class="label">Closed dates (no deliveries)</label>
            <div class="flex flex-wrap gap-2">
              <input id="closed" name="closed" type="date" class="input max-w-48" [(ngModel)]="newClosed" />
              <button type="button" class="btn-secondary" (click)="addClosed()">Add date</button>
            </div>
            <ul class="mt-2 flex flex-wrap gap-2">
              @for (d of s.closed_dates; track d) {
                <li class="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">{{ day(d) }}
                  <button type="button" class="text-slate-500 hover:text-red-600" [attr.aria-label]="'Remove ' + day(d)" (click)="removeClosed(d)">×</button></li>
              }
            </ul>
          </div>
        </fieldset>
        <app-flash [message]="msg()" [error]="msgErr()" />
        <button type="submit" class="btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save settings' }}</button>
      </form>
    }
  `,
})
export class AdminSettings implements OnInit {
  private readonly api = inject(AdminApi);
  protected s: BusinessSettings | null = null;
  protected newClosed = '';
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly msg = signal<string | null>(null);
  protected readonly msgErr = signal(false);
  protected readonly day = (d: string) => formatDay(d, true);

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      this.s = await this.api.settings();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected addClosed() {
    if (this.s && this.newClosed && !this.s.closed_dates.includes(this.newClosed)) {
      this.s.closed_dates = [...this.s.closed_dates, this.newClosed].sort();
    }
    this.newClosed = '';
  }

  protected removeClosed(d: string) {
    this.s!.closed_dates = this.s!.closed_dates.filter((x) => x !== d);
  }

  protected async save() {
    const s = this.s!;
    this.saving.set(true);
    this.msg.set(null);
    try {
      this.s = await this.api.saveSettings({
        deposit_enabled: s.deposit_enabled, cod_enabled: s.cod_enabled, online_payment_enabled: s.online_payment_enabled,
        max_advance_days: Number(s.max_advance_days), closed_dates: s.closed_dates, unpaid_order_expiry_minutes: Number(s.unpaid_order_expiry_minutes),
      });
      this.msgErr.set(false);
      this.msg.set(s.cod_enabled || s.online_payment_enabled ? 'Settings saved.' : 'Saved. Note: with both payment options off, nobody can order online.');
    } catch (e) {
      this.msgErr.set(true);
      this.msg.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}

// ---------------------------------------------------------------- Reviews
@Component({
  selector: 'app-admin-reviews',
  imports: [FormsModule, AdminTitle, Flash, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Reviews" subtitle="Publish only real reviews you have permission to show. Mark placeholders as samples.">
      @if (editingId() === null) {<button type="button" class="btn-primary" (click)="edit(null)">Add review</button>}
    </app-admin-title>
    <div class="mb-4"><app-flash [message]="msg()" [error]="msgErr()" /></div>
    @if (editingId() !== null) {
      <form class="card mb-6 grid gap-4 p-5 sm:grid-cols-2" (ngSubmit)="save()">
        <div><label for="t-name" class="label">Customer name *</label><input id="t-name" name="name" class="input" maxlength="60" [(ngModel)]="draft.author_name" /></div>
        <div><label for="t-loc" class="label">Area or type (optional)</label><input id="t-loc" name="loc" class="input" maxlength="60" [(ngModel)]="draft.author_location" placeholder="Office customer, Anna Nagar" /></div>
        <div class="sm:col-span-2"><label for="t-text" class="label">Review *</label><textarea id="t-text" name="text" rows="3" class="input" maxlength="600" [(ngModel)]="draft.content"></textarea></div>
        <div><label for="t-rating" class="label">Stars</label>
          <select id="t-rating" name="rating" class="input" [(ngModel)]="draft.rating"><option [ngValue]="null">No stars</option>@for (n of [5, 4, 3, 2, 1]; track n) {<option [ngValue]="n">{{ n }}</option>}</select></div>
        <div><label for="t-sort" class="label">Order</label><input id="t-sort" name="sort" type="number" class="input" [(ngModel)]="draft.sort_order" /></div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="pub" class="h-4 w-4" [(ngModel)]="draft.is_published" /> Published on the site</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="sample" class="h-4 w-4" [(ngModel)]="draft.is_sample" /> Sample (shown with a "Sample review" label)</label>
        <div class="flex gap-3 sm:col-span-2">
          <button type="submit" class="btn-primary" [disabled]="saving()">Save</button>
          <button type="button" class="btn-secondary" (click)="editingId.set(null)">Cancel</button>
        </div>
      </form>
    }
    @if (loading()) {<app-spinner />} @else if (error()) {<app-error [message]="error()!" [retry]="load" />} @else {
      <ul class="space-y-3">
        @for (t of items(); track t.id) {
          <li class="card p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <p class="font-semibold text-brand-900">{{ t.author_name }}
                @if (t.is_sample) {<span class="badge-sample ml-2">Sample</span>}
                @if (!t.is_published) {<span class="ml-2 text-xs font-normal text-slate-500">(not published)</span>}</p>
              <div class="flex gap-4 text-sm font-medium">
                <button type="button" class="text-brand-700 hover:underline" (click)="edit(t)">Edit</button>
                <button type="button" class="text-red-600 hover:underline" (click)="remove(t)">Delete</button>
              </div>
            </div>
            <p class="mt-1 text-sm text-slate-600">{{ t.content }}</p>
          </li>
        } @empty {<li class="card p-4 text-sm text-slate-500">No reviews.</li>}
      </ul>
    }
  `,
})
export class AdminReviews extends EditableList<AdminTestimonial, TestimonialInput> {
  private readonly api = inject(AdminApi);
  protected fetch = () => this.api.testimonials();
  protected persist = (id: number | null, t: TestimonialInput) =>
    this.api.saveTestimonial(id, { ...t, author_name: t.author_name.trim(), author_location: t.author_location?.trim() || null, content: t.content.trim(), sort_order: Number(t.sort_order) || 0 });
  protected blank = (): TestimonialInput => ({ author_name: '', author_location: '', content: '', rating: 5, is_sample: false, is_published: true, sort_order: 0 });
  protected toInput = ({ id: _id, ...t }: AdminTestimonial): TestimonialInput => ({ ...t, author_location: t.author_location ?? '' });
  protected override check(t: TestimonialInput) {
    if (t.author_name.trim().length < 2) return 'Enter the customer name.';
    return t.content.trim().length >= 10 ? null : 'The review must be at least 10 characters.';
  }
  protected async remove(t: AdminTestimonial) {
    if (!confirm(`Delete the review by ${t.author_name}?`)) return;
    try {
      await this.api.deleteTestimonial(t.id);
      this.items.update((xs) => xs.filter((x) => x.id !== t.id));
    } catch (e) {
      this.msgErr.set(true);
      this.msg.set(errorMessage(e));
    }
  }
}
