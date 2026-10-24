import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { AuthService } from '../shared/auth.service';
import { errorMessage } from '../shared/http';
import { Role, Staff } from '../shared/models';

@Component({
  selector: 'app-admin-staff',
  imports: [FormsModule],
  template: `
    <h1 class="h4 mb-3">Staff logins</h1>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    <form class="row g-2 align-items-end mb-3" (ngSubmit)="add()">
      <div class="col-md-3"><label class="form-label small">Name</label><input class="form-control" name="n" [(ngModel)]="name" required /></div>
      <div class="col-md-2"><label class="form-label small">Phone</label><input class="form-control" name="p" [(ngModel)]="phone" required /></div>
      <div class="col-md-2"><label class="form-label small">Role</label>
        <select class="form-select" name="r" [(ngModel)]="role"><option value="Staff">Staff</option><option value="Admin">Admin</option></select></div>
      <div class="col-md-3"><label class="form-label small">Password (8+ characters)</label><input type="password" class="form-control" name="pw" [(ngModel)]="password" autocomplete="new-password" required /></div>
      <div class="col-md-2"><button class="btn btn-success w-100" [disabled]="busy()">Add</button></div>
    </form>
    <p class="small text-body-secondary">Staff can do everything except manage staff logins. Admins can also add and switch off logins.</p>
    <table class="table table-sm align-middle table-stack">
      <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th></th></tr></thead>
      <tbody>
        @for (u of staff(); track u.id) {
          <tr [class.text-body-secondary]="!u.isActive">
            <td data-label="Name">{{ u.name }}</td><td data-label="Phone">{{ u.phone }}</td><td data-label="Role">{{ u.role }}</td>
            <td data-label="" class="text-end actions">
              @if (u.id !== me) {
                <button class="btn btn-sm btn-outline-secondary" (click)="toggle(u)" [disabled]="busy()">{{ u.isActive ? 'Switch off' : 'Switch on' }}</button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class AdminStaff {
  private api = inject(ApiService);
  me = inject(AuthService).user()?.userId;
  staff = signal<Staff[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);
  name = ''; phone = ''; role: Role = 'Staff'; password = '';

  constructor() {
    this.load();
  }

  async load() {
    try {
      this.staff.set(await this.api.staff());
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
      await this.api.addStaff({ name: this.name, phone: this.phone, role: this.role, password: this.password });
      this.name = this.phone = this.password = '';
    });
  }
  toggle(u: Staff) { return this.act(() => this.api.setStaffActive(u.id, !u.isActive)); }
}
