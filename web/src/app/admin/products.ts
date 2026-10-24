import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { APP_CONFIG } from '../core/app-config';
import { errorMessage } from '../core/api.service';
import { SupabaseService } from '../core/supabase.service';
import { formatDateTime } from '../shared/order-ui';
import { RupeesPipe } from '../shared/rupees.pipe';
import { ErrorBox, Spinner } from '../shared/ui';
import { AdminApi, AdminCategory, AdminProduct, ProductInput, StockEntry } from './admin-api';
import { AdminTitle, Flash } from './admin-ui';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // same limit as the storage bucket

@Component({
  selector: 'app-admin-products',
  imports: [ReactiveFormsModule, FormsModule, RupeesPipe, AdminTitle, Flash, Spinner, ErrorBox],
  template: `
    <app-admin-title title="Products" subtitle="Prices, stock, images and what is shown on the site.">
      @if (editing() === null) {<button type="button" class="btn-primary" (click)="edit(null)">Add product</button>}
    </app-admin-title>
    <div class="mb-4"><app-flash [message]="msg()" [error]="msgErr()" /></div>

    @if (editing() !== null) {
      <section class="card mb-6 p-5" aria-labelledby="pf-title">
        <h2 id="pf-title" class="text-base">{{ editing() === 'new' ? 'New product' : 'Edit ' + form.controls.name.value }}</h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" novalidate>
          <div class="sm:col-span-2">
            <label for="p-name" class="label">Name *</label>
            <input id="p-name" class="input" formControlName="name" (blur)="suggestSlug()" />
          </div>
          <div>
            <label for="p-slug" class="label">Web address name *</label>
            <input id="p-slug" class="input" formControlName="slug" placeholder="20-litre-water-can" />
            @if (form.controls.slug.invalid && form.controls.slug.touched) {<p class="field-error">Lowercase letters, numbers and dashes.</p>}
          </div>
          <div>
            <label for="p-cat" class="label">Category *</label>
            <select id="p-cat" class="input" formControlName="category_id">
              @for (c of categories(); track c.id) {<option [ngValue]="c.id">{{ c.name }}</option>}
            </select>
          </div>
          <div>
            <label for="p-price" class="label">Price (₹) *</label>
            <input id="p-price" type="number" step="0.01" min="0" class="input" formControlName="price" />
          </div>
          <div>
            <label for="p-unit" class="label">Unit shown to customers *</label>
            <input id="p-unit" class="input" formControlName="unit_label" placeholder="20 L can" />
          </div>
          <div>
            <label for="p-min" class="label">Minimum per order</label>
            <input id="p-min" type="number" min="1" class="input" formControlName="min_order_qty" />
          </div>
          <div>
            <label for="p-max" class="label">Maximum per order</label>
            <input id="p-max" type="number" min="1" class="input" formControlName="max_order_qty" />
          </div>
          <div class="sm:col-span-2 lg:col-span-4">
            <label for="p-short" class="label">Short description (product cards)</label>
            <input id="p-short" class="input" maxlength="200" formControlName="short_description" />
          </div>
          <div class="sm:col-span-2 lg:col-span-4">
            <label for="p-desc" class="label">Full description (product page)</label>
            <textarea id="p-desc" rows="3" class="input" maxlength="2000" formControlName="description"></textarea>
            <p class="mt-1 text-xs text-slate-500">Describe only what you can stand behind. Avoid health or certification claims unless you hold the certificate.</p>
          </div>

          <fieldset class="space-y-2 text-sm sm:col-span-2">
            <legend class="label">Options</legend>
            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4" formControlName="is_active" /> Shown on the site</label>
            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4" formControlName="is_sample_price" /> Mark the price as a sample (shows a "Sample price" badge)</label>
            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4" formControlName="track_stock" /> Track stock (stop orders at zero)</label>
            <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4" formControlName="is_returnable_can" /> Returnable can (deposit for new cans)</label>
          </fieldset>
          <div>
            <label for="p-cans" class="label">Returnable cans in one unit</label>
            <input id="p-cans" type="number" min="1" max="100" class="input" formControlName="cans_per_unit" />
            <p class="mt-1 text-xs text-slate-500">1 for a single can, 5 for a pack of five.</p>
          </div>
          <div>
            <label for="p-dep" class="label">Deposit per new can (₹)</label>
            <input id="p-dep" type="number" step="0.01" min="0" class="input" formControlName="deposit_amount" />
          </div>
          <div>
            <label for="p-sort" class="label">Order on the page</label>
            <input id="p-sort" type="number" class="input" formControlName="sort_order" />
          </div>

          <div class="sm:col-span-2 lg:col-span-4">
            <span class="label">Image</span>
            <div class="flex flex-wrap items-center gap-4">
              @if (previewUrl()) {
                <img [src]="previewUrl()" alt="Current product image" class="h-24 w-24 rounded-xl border border-slate-200 object-cover" />
              } @else {
                <div class="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-400">No image</div>
              }
              <div class="space-y-2">
                <label class="btn-secondary cursor-pointer">
                  {{ uploading() ? 'Uploading…' : 'Upload image' }}
                  <input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" (change)="upload($event)" [disabled]="uploading()" />
                </label>
                @if (form.controls.image_path.value) {
                  <button type="button" class="ml-2 text-sm text-red-600 hover:underline" (click)="form.controls.image_path.setValue('')">Remove image</button>
                }
                <p class="text-xs text-slate-500">JPG, PNG or WebP, up to 5 MB. Square photos look best. Use your own photos only.</p>
                @if (uploadError()) {<p class="field-error" role="alert">{{ uploadError() }}</p>}
              </div>
            </div>
          </div>

          @if (formError()) {<p class="rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:col-span-2 lg:col-span-4" role="alert">{{ formError() }}</p>}
          <div class="flex gap-3 sm:col-span-2 lg:col-span-4">
            <button type="submit" class="btn-primary" [disabled]="saving() || uploading()">{{ saving() ? 'Saving…' : 'Save product' }}</button>
            <button type="button" class="btn-secondary" (click)="editing.set(null)">Cancel</button>
          </div>
        </form>
      </section>
    }

    @if (stockFor(); as p) {
      <section class="card mb-6 p-5" aria-labelledby="st-title">
        <h2 id="st-title" class="text-base">Stock: {{ p.name }} (now {{ p.stock_qty }})</h2>
        <form class="mt-3 flex flex-wrap items-end gap-3" (ngSubmit)="adjust(p)">
          <div>
            <label for="s-delta" class="label">Change (+ in, − out)</label>
            <input id="s-delta" name="delta" type="number" class="input w-32" [(ngModel)]="delta" />
          </div>
          <div>
            <label for="s-reason" class="label">Reason</label>
            <select id="s-reason" name="reason" class="input" [(ngModel)]="reason">
              <option value="restock">New stock arrived</option><option value="adjustment">Count correction</option><option value="damaged">Damaged / lost</option>
            </select>
          </div>
          <div class="min-w-48 flex-1">
            <label for="s-note" class="label">Note</label>
            <input id="s-note" name="note" class="input" maxlength="300" [(ngModel)]="stockNote" />
          </div>
          <button type="submit" class="btn-primary" [disabled]="saving()">Record</button>
          <button type="button" class="btn-secondary" (click)="stockFor.set(null)">Close</button>
        </form>
        @if (history().length) {
          <table class="mt-4 w-full text-sm">
            <thead class="text-left text-xs text-slate-500 uppercase"><tr><th class="py-1">When</th><th class="py-1">Change</th><th class="py-1">Reason</th><th class="py-1">By / order</th></tr></thead>
            <tbody>
              @for (h of history(); track h.id) {
                <tr class="border-t border-slate-100">
                  <td class="py-1.5">{{ when(h.created_at) }}</td>
                  <td class="py-1.5 font-semibold" [class]="h.qty_delta < 0 ? 'text-red-700' : 'text-green-700'">{{ h.qty_delta > 0 ? '+' : '' }}{{ h.qty_delta }}</td>
                  <td class="py-1.5">{{ h.reason.replace('_', ' ') }}@if (h.note) {<span class="text-slate-500"> – {{ h.note }}</span>}</td>
                  <td class="py-1.5">{{ h.order_no || h.created_by_name || '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error [message]="error()!" [retry]="load" />
    } @else {
      <div class="card relative overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr><th class="px-4 py-3">Product</th><th class="px-4 py-3">Category</th><th class="px-4 py-3 text-right">Price</th>
                <th class="px-4 py-3 text-center">Stock</th><th class="px-4 py-3">Shown</th><th class="px-4 py-3"><span class="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            @for (p of products(); track p.id) {
              <tr class="border-b border-slate-100 last:border-0">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3">
                    @if (p.image_url) {<img [src]="p.image_url" alt="" class="h-10 w-10 rounded-lg object-cover" />}
                    <div><span class="font-semibold text-brand-900">{{ p.name }}</span><div class="text-xs text-slate-500">{{ p.unit_label }}</div></div>
                  </div>
                </td>
                <td class="px-4 py-3">{{ categoryName(p.category_id) }}</td>
                <td class="px-4 py-3 text-right">{{ p.price | rupees }}@if (p.is_sample_price) {<div><span class="badge-sample">Sample</span></div>}</td>
                <td class="px-4 py-3 text-center" [class.text-red-700]="p.track_stock && p.stock_qty < 10">{{ p.track_stock ? p.stock_qty : 'not tracked' }}</td>
                <td class="px-4 py-3">{{ p.is_active ? 'Yes' : 'Hidden' }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" class="font-medium text-brand-700 hover:underline" (click)="edit(p)">Edit</button>
                  @if (p.track_stock) {<button type="button" class="ml-4 font-medium text-brand-700 hover:underline" (click)="openStock(p)">Stock</button>}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminProducts implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly supabase = inject(SupabaseService);
  private readonly supabaseUrl = inject(APP_CONFIG).supabaseUrl;

  protected readonly products = signal<AdminProduct[]>([]);
  protected readonly categories = signal<AdminCategory[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<AdminProduct | 'new' | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly msg = signal<string | null>(null);
  protected readonly msgErr = signal(false);
  protected readonly stockFor = signal<AdminProduct | null>(null);
  protected readonly history = signal<StockEntry[]>([]);
  protected readonly when = formatDateTime;
  protected delta: number | null = null;
  protected reason: 'restock' | 'adjustment' | 'damaged' = 'restock';
  protected stockNote = '';

  protected readonly form = inject(FormBuilder).nonNullable.group({
    category_id: [0, Validators.min(1)],
    slug: ['', [Validators.required, Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/), Validators.maxLength(80)]],
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    short_description: [''],
    description: [''],
    unit_label: ['', [Validators.required, Validators.maxLength(60)]],
    price: [0, [Validators.required, Validators.min(0)]],
    is_sample_price: [true],
    is_returnable_can: [false],
    cans_per_unit: [1, [Validators.min(1), Validators.max(100)]],
    deposit_amount: [0, Validators.min(0)],
    track_stock: [true],
    min_order_qty: [1, Validators.min(1)],
    max_order_qty: [50, Validators.min(1)],
    image_path: [''],
    sort_order: [0],
    is_active: [true],
  });
  private readonly imagePath = signal('');
  protected readonly previewUrl = computed(() => {
    const path = this.imagePath();
    if (!path) return null;
    if (/^(https?:)?\//.test(path)) return path;
    return `${this.supabaseUrl}/storage/v1/object/public/product-images/${encodeURI(path)}`;
  });

  constructor() {
    this.form.controls.image_path.valueChanges.subscribe((v) => this.imagePath.set(v));
  }

  ngOnInit() {
    this.load();
  }

  protected readonly load = async () => {
    this.error.set(null);
    try {
      const [products, categories] = await Promise.all([this.api.products(), this.api.categories()]);
      this.products.set(products);
      this.categories.set(categories);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected categoryName(id: number) {
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }

  protected edit(p: AdminProduct | null) {
    this.formError.set(null);
    this.uploadError.set(null);
    this.msg.set(null);
    if (p) {
      this.form.reset({ ...p, short_description: p.short_description ?? '', description: p.description ?? '', image_path: p.image_path ?? '' });
    } else {
      this.form.reset();
      this.form.patchValue({ category_id: this.categories()[0]?.id ?? 0 });
    }
    this.imagePath.set(this.form.controls.image_path.value);
    this.editing.set(p ?? 'new');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected suggestSlug() {
    const slug = this.form.controls.slug;
    if (slug.value) return;
    slug.setValue(this.form.controls.name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80));
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.formError.set('Please fill in the required fields (marked *).');
      return;
    }
    const v = this.form.getRawValue();
    if (Number(v.max_order_qty) < Number(v.min_order_qty)) {
      this.formError.set('Maximum per order must be at least the minimum.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    const editing = this.editing();
    const input: ProductInput = {
      ...v,
      price: Number(v.price), deposit_amount: Number(v.deposit_amount) || 0, cans_per_unit: Math.max(1, Math.trunc(Number(v.cans_per_unit)) || 1),
      min_order_qty: Number(v.min_order_qty), max_order_qty: Number(v.max_order_qty), sort_order: Number(v.sort_order) || 0,
      short_description: v.short_description.trim() || null, description: v.description.trim() || null, image_path: v.image_path || null,
    };
    try {
      const saved = await this.api.saveProduct(editing === 'new' ? null : editing!.id, input);
      this.products.update((ps) => (editing === 'new' ? [...ps, saved] : ps.map((p) => (p.id === saved.id ? saved : p))));
      this.editing.set(null);
      this.msgErr.set(false);
      this.msg.set(`Saved ${saved.name}.`);
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  /** Uploads straight to Supabase Storage; the bucket only accepts uploads from admins. */
  protected async upload(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    this.uploadError.set(null);
    if (!IMAGE_TYPES.includes(file.type)) return this.uploadError.set('Please choose a JPG, PNG or WebP image.');
    if (file.size > MAX_IMAGE_BYTES) return this.uploadError.set('That image is larger than 5 MB. Please use a smaller one.');

    this.uploading.set(true);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const base = (this.form.controls.slug.value || 'product').slice(0, 60);
      const path = `products/${base}-${Date.now().toString(36)}.${ext}`;
      const sb = await this.supabase.client();
      const { error } = await sb.storage.from('product-images').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      this.form.controls.image_path.setValue(path);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      this.uploadError.set(/row-level security|unauthorized|403/i.test(m) ? 'Only admins can upload images.' : 'Upload failed. Please check your connection and try again.');
    } finally {
      this.uploading.set(false);
    }
  }

  protected async openStock(p: AdminProduct) {
    this.stockFor.set(p);
    this.delta = null;
    this.stockNote = '';
    this.history.set([]);
    try {
      this.history.set(await this.api.stockHistory(p.id));
    } catch {
      // The form still works without the history.
    }
  }

  protected async adjust(p: AdminProduct) {
    const delta = Math.trunc(Number(this.delta));
    if (!delta) {
      this.msgErr.set(true);
      this.msg.set('Enter how many to add (e.g. 50) or remove (e.g. -3).');
      return;
    }
    this.saving.set(true);
    try {
      const { stock_qty } = await this.api.adjustStock(p.id, delta, this.reason, this.stockNote.trim() || null);
      const updated = { ...p, stock_qty };
      this.products.update((ps) => ps.map((x) => (x.id === p.id ? updated : x)));
      this.msgErr.set(false);
      this.msg.set(`Stock for ${p.name} is now ${stock_qty}.`);
      await this.openStock(updated);
    } catch (e) {
      this.msgErr.set(true);
      this.msg.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
