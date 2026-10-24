import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { AuthService } from '../shared/auth.service';
import { errorMessage } from '../shared/http';

/** Phone number, then the 4-digit code we text. */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="row justify-content-center">
      <div class="col-md-6 col-lg-5">
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <h1 class="h4 mb-1">Sign in</h1>
            <p class="text-body-secondary mb-4">We'll text a 4-digit code to your mobile number.</p>
            @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
            @if (info()) { <div class="alert alert-info py-2">{{ info() }}</div> }

            @if (!codeSent()) {
              <form (ngSubmit)="sendCode()">
                <label class="form-label" for="phone">Mobile number</label>
                <input id="phone" class="form-control form-control-lg mb-3" name="phone" [(ngModel)]="phone"
                       inputmode="tel" autocomplete="tel" placeholder="98765 43210" required />
                <button class="btn btn-primary btn-lg w-100" [disabled]="busy() || !phone.trim()">Send code</button>
              </form>
              <p class="mt-3 mb-0 text-center">New customer? <a routerLink="/register">Create an account</a></p>
            } @else {
              <form (ngSubmit)="verify()">
                <label class="form-label" for="otp">Code sent to {{ phone }}</label>
                <input id="otp" class="form-control form-control-lg mb-3 text-center otp-input" name="otp" [(ngModel)]="otp"
                       inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="••••" required />
                <button class="btn btn-primary btn-lg w-100" [disabled]="busy() || otp.length !== 4">Sign in</button>
              </form>
              <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-link p-0" (click)="codeSent.set(false); otp = ''">Change number</button>
                <button class="btn btn-link p-0" [disabled]="busy()" (click)="sendCode()">Send again</button>
              </div>
            }
          </div>
        </div>
        <p class="text-center mt-3 small"><a routerLink="/admin/login" class="text-body-secondary">Staff sign-in</a></p>
      </div>
    </div>
  `,
})
export class Login {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  phone = inject(ActivatedRoute).snapshot.queryParamMap.get('phone') ?? '';
  otp = '';
  codeSent = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  info = signal<string | null>(null);

  constructor() {
    if (this.phone) this.sendCode(); // just registered
  }

  async sendCode() {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.api.requestOtp(this.phone);
      this.codeSent.set(true);
      this.info.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    this.error.set(null);
    this.busy.set(true);
    try {
      const t = await this.api.verifyOtp(this.phone, this.otp);
      if (t.user.role === 'Driver') {
        this.info.set('Drivers use the WBMS mobile app to see and deliver orders.');
        this.codeSent.set(false);
        this.otp = '';
        return;
      }
      this.auth.signIn(t);
      this.router.navigateByUrl(t.user.role === 'Customer' ? '/' : '/admin');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
