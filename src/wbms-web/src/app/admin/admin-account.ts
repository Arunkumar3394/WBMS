import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../shared/api.service';
import { AuthService } from '../shared/auth.service';
import { errorMessage } from '../shared/http';

@Component({
  selector: 'app-admin-account',
  imports: [FormsModule],
  template: `
    <h1 class="h4 mb-3">Your account</h1>
    <p>{{ auth.user()?.name }} · {{ auth.user()?.phone }} · {{ auth.user()?.role }}</p>
    @if (message()) { <div class="alert py-2" [class.alert-success]="ok()" [class.alert-danger]="!ok()">{{ message() }}</div> }
    <form class="account-form" (ngSubmit)="save()">
      <h2 class="h6">Change password</h2>
      <label class="form-label small" for="c">Current password</label>
      <input id="c" type="password" class="form-control mb-2" name="c" [(ngModel)]="current" autocomplete="current-password" required />
      <label class="form-label small" for="n">New password (8+ characters)</label>
      <input id="n" type="password" class="form-control mb-3" name="n" [(ngModel)]="next" autocomplete="new-password" required />
      <button class="btn btn-primary" [disabled]="busy()">Change password</button>
    </form>
  `,
})
export class AdminAccount {
  private api = inject(ApiService);
  auth = inject(AuthService);
  current = '';
  next = '';
  busy = signal(false);
  ok = signal(false);
  message = signal<string | null>(null);

  async save() {
    this.busy.set(true);
    try {
      await this.api.changePassword(this.current, this.next);
      this.ok.set(true);
      this.message.set('Password changed.');
    } catch (e) {
      this.ok.set(false);
      this.message.set(errorMessage(e));
    } finally {
      this.current = this.next = '';
      this.busy.set(false);
    }
  }
}
