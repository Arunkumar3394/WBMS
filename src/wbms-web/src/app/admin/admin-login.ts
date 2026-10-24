import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { AuthService } from '../shared/auth.service';
import { errorMessage } from '../shared/http';

@Component({
  selector: 'app-admin-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-vh-100 d-flex align-items-center justify-content-center bg-body-tertiary px-3">
      <div class="card shadow-sm login-card">
        <div class="card-body p-4">
          <h1 class="h4 mb-1">💧 WBMS Admin</h1>
          <p class="text-body-secondary mb-4">Staff sign-in</p>
          @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
          <form (ngSubmit)="signIn()">
            <label class="form-label" for="phone">Phone number</label>
            <input id="phone" class="form-control mb-3" name="phone" [(ngModel)]="phone" inputmode="tel" autocomplete="username" required />
            <label class="form-label" for="password">Password</label>
            <input id="password" class="form-control mb-4" type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required />
            <button class="btn btn-primary w-100" [disabled]="busy()">Sign in</button>
          </form>
          <p class="text-center small mt-3 mb-0"><a routerLink="/login" class="text-body-secondary">Customer sign-in</a></p>
        </div>
      </div>
    </div>
  `,
})
export class AdminLogin {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  phone = '';
  password = '';
  busy = signal(false);
  error = signal<string | null>(null);

  async signIn() {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.auth.signIn(await this.api.passwordLogin(this.phone, this.password));
      this.router.navigateByUrl('/admin');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
