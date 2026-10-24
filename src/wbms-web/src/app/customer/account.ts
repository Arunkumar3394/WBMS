import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Invoice, Profile } from '../shared/models';

@Component({
  selector: 'app-account',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  template: `
    <h1 class="h4 mb-3">Your account</h1>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    @if (profile(); as p) {
      <div class="card mb-4"><div class="card-body">
        <div class="fw-semibold">{{ p.name }}</div>
        <div class="text-body-secondary">{{ p.phone }}</div>
        <div class="mt-2">Dues: <strong>{{ (p.balance ?? 0) | currency: 'INR' : 'symbol' : '1.0-0' }}</strong> ·
          Cans with you: <strong>{{ p.cansHeld ?? 0 }}</strong></div>
        <div class="small text-body-secondary mt-1">To pay dues, pay the driver with your next order or call us.</div>
      </div></div>

      <h2 class="h5">Addresses</h2>
      <ul class="list-group mb-3">
        @for (a of p.addresses; track a.id) {
          <li class="list-group-item">{{ a.line }}{{ a.area ? ', ' + a.area : '' }}
            @if (a.isDefault) { <span class="badge text-bg-light ms-1">Default</span> }
          </li>
        }
      </ul>
      <form class="row g-2 mb-4" (ngSubmit)="addAddress()">
        <div class="col-md-5"><input class="form-control" name="line" [(ngModel)]="line" placeholder="Door no, street" required /></div>
        <div class="col-md-3"><input class="form-control" name="area" [(ngModel)]="area" placeholder="Area" /></div>
        <div class="col-md-2 d-flex align-items-center">
          <div class="form-check"><input class="form-check-input" type="checkbox" id="def" name="def" [(ngModel)]="isDefault" />
            <label class="form-check-label" for="def">Default</label></div>
        </div>
        <div class="col-md-2"><button class="btn btn-outline-primary w-100" [disabled]="busy() || !line.trim()">Add</button></div>
      </form>

      <h2 class="h5">Invoices</h2>
      @if (invoices().length === 0) { <p class="text-body-secondary">Invoices appear here after each delivery.</p> }
      <div class="table-responsive">
        <table class="table align-middle">
          <tbody>
            @for (i of invoices(); track i.id) {
              <tr>
                <td>{{ i.invoiceNo }}<div class="small text-body-secondary">{{ i.issuedAt | date: 'mediumDate' }}</div></td>
                <td class="text-end">{{ i.amount | currency: 'INR' : 'symbol' : '1.0-0' }}
                  @if (i.status !== 'Paid') { <div class="small text-danger">Due {{ i.amount - i.amountPaid | currency: 'INR' : 'symbol' : '1.0-0' }}</div> }
                </td>
                <td class="text-end"><button class="btn btn-sm btn-outline-secondary" (click)="download(i)">PDF</button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class Account {
  private api = inject(ApiService);
  profile = signal<Profile | null>(null);
  invoices = signal<Invoice[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);
  line = '';
  area = '';
  isDefault = false;

  constructor() {
    this.load();
  }

  async load() {
    try {
      const p = await this.api.me();
      this.profile.set(p);
      if (p.customerId) this.invoices.set(await this.api.invoices(p.customerId));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async addAddress() {
    this.busy.set(true);
    try {
      await this.api.addAddress({ line: this.line, area: this.area, isDefault: this.isDefault });
      this.line = this.area = '';
      this.isDefault = false;
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async download(i: Invoice) {
    try {
      await this.api.downloadInvoice(i.id, i.invoiceNo);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
