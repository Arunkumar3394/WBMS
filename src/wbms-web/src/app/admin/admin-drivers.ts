import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Driver } from '../shared/models';

@Component({
  selector: 'app-admin-drivers',
  imports: [FormsModule],
  template: `
    <h1 class="h4 mb-3">Drivers</h1>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    <form class="row g-2 align-items-end mb-3" (ngSubmit)="add()">
      <div class="col-md-3"><label class="form-label small">Name</label><input class="form-control" name="n" [(ngModel)]="name" required /></div>
      <div class="col-md-2"><label class="form-label small">Phone</label><input class="form-control" name="p" [(ngModel)]="phone" required /></div>
      <div class="col-md-2"><label class="form-label small">Licence no.</label><input class="form-control" name="l" [(ngModel)]="licenseNo" /></div>
      <div class="col-md-2"><label class="form-label small">Vehicle no.</label><input class="form-control" name="v" [(ngModel)]="vehicleNo" /></div>
      <div class="col-md-1"><label class="form-label small">Cans</label><input type="number" class="form-control" name="c" [(ngModel)]="capacity" /></div>
      <div class="col-md-2"><button class="btn btn-success w-100" [disabled]="busy()">Add driver</button></div>
    </form>
    <p class="small text-body-secondary">Drivers sign in to the WBMS mobile app with their phone number and a code sent by SMS.</p>
    <table class="table table-sm align-middle">
      <thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Capacity</th><th></th></tr></thead>
      <tbody>
        @for (d of drivers(); track d.id) {
          <tr [class.text-body-secondary]="!d.user.isActive">
            <td>{{ d.user.name }}</td><td>{{ d.user.phone }}</td><td>{{ d.vehicleNo }}</td><td>{{ d.vehicleCapacity }}</td>
            <td class="text-end">
              <button class="btn btn-sm" [class.btn-outline-secondary]="d.user.isActive" [class.btn-outline-success]="!d.user.isActive"
                      (click)="toggle(d)" [disabled]="busy()">{{ d.user.isActive ? 'Switch off' : 'Switch on' }}</button>
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class AdminDrivers {
  private api = inject(ApiService);
  drivers = signal<Driver[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);
  name = ''; phone = ''; licenseNo = ''; vehicleNo = ''; capacity = 40;

  constructor() {
    this.load();
  }

  async load() {
    try {
      this.drivers.set(await this.api.drivers());
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
      await this.api.addDriver({ name: this.name, phone: this.phone, licenseNo: this.licenseNo, vehicleNo: this.vehicleNo, vehicleCapacity: this.capacity });
      this.name = this.phone = this.licenseNo = this.vehicleNo = '';
    });
  }

  toggle(d: Driver) {
    return this.act(() => this.api.setDriverActive(d.id, !d.user.isActive));
  }
}
