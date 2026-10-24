import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Customer, CustomerType } from '../shared/models';

@Component({
  selector: 'app-admin-customers',
  imports: [FormsModule, DecimalPipe],
  template: `
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <h1 class="h4 mb-0 me-3">Customers</h1>
      <input class="form-control form-control-sm w-auto" placeholder="Search name or phone" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <div class="form-check ms-2"><input id="due" class="form-check-input" type="checkbox" [ngModel]="duesOnly()" (ngModelChange)="duesOnly.set($event)" />
        <label for="due" class="form-check-label small">With dues</label></div>
    </div>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }

    <details class="card mb-3"><summary class="card-header">Add a customer</summary><div class="card-body">
      <form class="row g-2 align-items-end" (ngSubmit)="add()">
        <div class="col-md-2"><label class="form-label small">Name</label><input class="form-control" name="n" [(ngModel)]="name" required /></div>
        <div class="col-md-2"><label class="form-label small">Phone</label><input class="form-control" name="p" [(ngModel)]="phone" required /></div>
        <div class="col-md-1"><label class="form-label small">Type</label>
          <select class="form-select" name="t" [(ngModel)]="type">@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select></div>
        <div class="col-md-1"><label class="form-label small">Credit limit</label><input type="number" class="form-control" name="cl" [(ngModel)]="creditLimit" /></div>
        <div class="col-md-3"><label class="form-label small">Address</label><input class="form-control" name="l" [(ngModel)]="line" /></div>
        <div class="col-md-2"><label class="form-label small">Area</label><input class="form-control" name="a" [(ngModel)]="area" /></div>
        <div class="col-md-1"><button class="btn btn-success w-100" [disabled]="busy()">Add</button></div>
      </form>
    </div></details>

    <div class="table-responsive">
      <table class="table table-sm align-middle table-stack">
        <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th class="text-end">Credit limit</th><th class="text-end">Due (₹)</th><th class="text-end">Cans</th><th>Settle dues (cash)</th></tr></thead>
        <tbody>
          @for (c of shown(); track c.id) {
            <tr [class.text-body-secondary]="!c.user.isActive">
              <td data-label="Name"><span>{{ c.user.name }} <span class="badge text-bg-light">{{ c.type }}</span>
                @if (!c.user.isActive) { <span class="badge text-bg-secondary">Off</span> }</span></td>
              <td data-label="Phone"><a [href]="'tel:' + c.user.phone">{{ c.user.phone }}</a></td>
              <td data-label="Address" class="small">{{ c.addresses[0]?.line }}{{ c.addresses[0]?.area ? ', ' + c.addresses[0]?.area : '' }}</td>
              <td data-label="Credit limit" class="text-end">
                <input type="number" class="form-control form-control-sm text-end limit" [ngModel]="c.creditLimit" (change)="setLimit(c, $any($event.target).value)" />
              </td>
              <td data-label="Due (₹)" class="text-end" [class.text-danger]="c.balance > 0">{{ c.balance | number: '1.0-0' }}</td>
              <td data-label="Cans" class="text-end">{{ c.cansHeld }}</td>
              <td data-label="" class="actions">
                @if (c.balance > 0) {
                  <div class="input-group input-group-sm settle">
                    <input type="number" class="form-control" [(ngModel)]="settleAmount[c.id]" [placeholder]="c.balance" />
                    <button class="btn btn-outline-success" (click)="settle(c)" [disabled]="busy()">Received</button>
                  </div>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminCustomers {
  private api = inject(ApiService);
  types: CustomerType[] = ['Home', 'Shop', 'Office'];
  customers = signal<Customer[]>([]);
  search = signal('');
  duesOnly = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  settleAmount: Record<number, number | null> = {};
  name = ''; phone = ''; type: CustomerType = 'Home'; creditLimit = 0; line = ''; area = '';

  shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.customers().filter((c) =>
      (!q || c.user.name.toLowerCase().includes(q) || c.user.phone.includes(q)) && (!this.duesOnly() || c.balance > 0));
  });

  constructor() {
    this.load();
  }

  async load() {
    try {
      this.customers.set(await this.api.customers());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private async act(fn: () => Promise<unknown>) {
    this.error.set(null);
    this.busy.set(true);
    try {
      await fn();
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  add() {
    return this.act(async () => {
      await this.api.addCustomer({ name: this.name, phone: this.phone, type: this.type, creditLimit: this.creditLimit, addressLine: this.line, area: this.area });
      this.name = this.phone = this.line = this.area = '';
      this.creditLimit = 0;
    });
  }

  setLimit(c: Customer, value: string) {
    return this.act(() => this.api.updateCustomer(c.id, { name: c.user.name, type: c.type, creditLimit: Number(value) || 0, isActive: c.user.isActive }));
  }

  settle(c: Customer) {
    const amount = this.settleAmount[c.id] ?? c.balance;
    return this.act(async () => {
      await this.api.settle(c.id, amount, 'Cash', 'Office');
      this.settleAmount[c.id] = null;
    });
  }
}
