import { Component, OnInit, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../core/auth.guard';
import { AuthService } from '../core/auth.service';

/** At least 8 characters with a letter and a number. */
const passwordRules = [Validators.required, Validators.minLength(8), Validators.maxLength(72), Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)];
const PASSWORD_HINT = 'At least 8 characters, with letters and numbers.';

function invalid(c: AbstractControl): true | null {
  return c.invalid && (c.touched || c.dirty) ? true : null;
}

const CARD = 'card mx-auto w-full max-w-md p-6 sm:p-8';

// ---------------------------------------------------------------- Sign in
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container-page py-14">
      <div class="${CARD}">
        <h1 class="text-2xl">Sign in</h1>
        <p class="mt-1 text-slate-600">Welcome back. Sign in to order and track your deliveries.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
          <div>
            <label for="email" class="label">Email</label>
            <input id="email" type="email" formControlName="email" class="input" autocomplete="email" [attr.aria-invalid]="bad('email')" />
            @if (bad('email')) {<p class="field-error">Enter your email address.</p>}
          </div>
          <div>
            <div class="flex items-center justify-between">
              <label for="password" class="label">Password</label>
              <a routerLink="/forgot-password" class="mb-1 text-sm text-brand-700 hover:underline">Forgot password?</a>
            </div>
            <input id="password" type="password" formControlName="password" class="input" autocomplete="current-password" [attr.aria-invalid]="bad('password')" />
            @if (bad('password')) {<p class="field-error">Enter your password.</p>}
          </div>
          @if (error()) {<p class="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ error() }}</p>}
          <button type="submit" class="btn-primary w-full py-3" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        </form>
        <p class="mt-6 text-center text-sm text-slate-600">
          New to AquaPure? <a routerLink="/register" [queryParams]="{ returnUrl: returnUrl() }" class="font-semibold text-brand-700 hover:underline">Create an account</a>
        </p>
      </div>
    </div>
  `,
})
export class Login {
  readonly returnUrl = input<string>();
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected bad = (name: 'email' | 'password') => invalid(this.form.controls[name]);

  protected async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email.trim(), password);
    } catch (e) {
      this.error.set((e as Error).message);
      return;
    } finally {
      this.busy.set(false);
    }
    // Signed in. If the page they wanted fails to open, go to their account instead of showing an error.
    await this.router.navigateByUrl(safeReturnUrl(this.returnUrl())).catch(() => this.router.navigateByUrl('/account'));
  }
}

// ---------------------------------------------------------------- Create account
@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container-page py-14">
      <div class="${CARD}">
        @if (checkEmail()) {
          <div role="status">
            <h1 class="text-2xl">Check your email</h1>
            <p class="mt-3 text-slate-600">
              We sent a confirmation link to <strong>{{ form.controls.email.value }}</strong>. Open it to activate your
              account, then you can order. If it doesn't arrive in a few minutes, check your spam folder.
            </p>
            <a routerLink="/login" class="btn-secondary mt-6 w-full">Back to sign in</a>
          </div>
        } @else {
          <h1 class="text-2xl">Create your account</h1>
          <p class="mt-1 text-slate-600">Save your addresses, order in a few taps and track every delivery.</p>
          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
            <div>
              <label for="name" class="label">Full name</label>
              <input id="name" formControlName="fullName" class="input" autocomplete="name" [attr.aria-invalid]="bad('fullName')" />
              @if (bad('fullName')) {<p class="field-error">Enter your name.</p>}
            </div>
            <div>
              <label for="email" class="label">Email</label>
              <input id="email" type="email" formControlName="email" class="input" autocomplete="email" [attr.aria-invalid]="bad('email')" />
              @if (bad('email')) {<p class="field-error">Enter a valid email address.</p>}
            </div>
            <div>
              <label for="password" class="label">Password</label>
              <input id="password" type="password" formControlName="password" class="input" autocomplete="new-password"
                     aria-describedby="password-hint" [attr.aria-invalid]="bad('password')" />
              <p id="password-hint" class="mt-1 text-xs" [class.text-red-600]="bad('password')" [class.text-slate-500]="!bad('password')">${PASSWORD_HINT}</p>
            </div>
            @if (error()) {<p class="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ error() }}</p>}
            <button type="submit" class="btn-primary w-full py-3" [disabled]="busy()">{{ busy() ? 'Creating account…' : 'Create account' }}</button>
          </form>
          <p class="mt-6 text-center text-sm text-slate-600">
            Already have an account? <a routerLink="/login" [queryParams]="{ returnUrl: returnUrl() }" class="font-semibold text-brand-700 hover:underline">Sign in</a>
          </p>
        }
      </div>
    </div>
  `,
})
export class Register {
  readonly returnUrl = input<string>();
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly checkEmail = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', passwordRules],
  });

  protected bad = (name: 'fullName' | 'email' | 'password') => invalid(this.form.controls[name]);

  protected async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    let needsConfirmation: boolean;
    try {
      const { fullName, email, password } = this.form.getRawValue();
      ({ needsConfirmation } = await this.auth.signUp(email.trim(), password, fullName.trim()));
    } catch (e) {
      this.error.set((e as Error).message);
      return;
    } finally {
      this.busy.set(false);
    }
    if (needsConfirmation) this.checkEmail.set(true);
    else await this.router.navigateByUrl(safeReturnUrl(this.returnUrl())).catch(() => this.router.navigateByUrl('/account'));
  }
}

// ---------------------------------------------------------------- Forgot password
@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container-page py-14">
      <div class="${CARD}">
        <h1 class="text-2xl">Reset your password</h1>
        @if (sent()) {
          <p class="mt-3 text-slate-600" role="status">
            If an account exists for <strong>{{ form.controls.email.value }}</strong>, we have emailed a link to set a new password.
          </p>
          <a routerLink="/login" class="btn-secondary mt-6 w-full">Back to sign in</a>
        } @else {
          <p class="mt-1 text-slate-600">Enter your email and we will send you a link to set a new password.</p>
          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
            <div>
              <label for="email" class="label">Email</label>
              <input id="email" type="email" formControlName="email" class="input" autocomplete="email" [attr.aria-invalid]="bad()" />
              @if (bad()) {<p class="field-error">Enter a valid email address.</p>}
            </div>
            @if (error()) {<p class="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ error() }}</p>}
            <button type="submit" class="btn-primary w-full py-3" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send reset link' }}</button>
          </form>
        }
      </div>
    </div>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  protected bad = () => invalid(this.form.controls.email);

  protected async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.sendPasswordReset(this.form.controls.email.value.trim());
      this.sent.set(true); // same message whether or not the account exists
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}

// ---------------------------------------------------------------- Set a new password (from the email link)
function matching(group: AbstractControl): ValidationErrors | null {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container-page py-14">
      <div class="${CARD}">
        <h1 class="text-2xl">Choose a new password</h1>
        @if (!auth.signedIn()) {
          <p class="mt-3 text-slate-600">This link has expired or was already used. Please request a new one.</p>
          <a routerLink="/forgot-password" class="btn-primary mt-6 w-full">Send a new link</a>
        } @else if (done()) {
          <p class="mt-3 text-slate-600" role="status">Your password has been changed.</p>
          <a routerLink="/account" class="btn-primary mt-6 w-full">Go to my account</a>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
            <div>
              <label for="password" class="label">New password</label>
              <input id="password" type="password" formControlName="password" class="input" autocomplete="new-password"
                     aria-describedby="password-hint" [attr.aria-invalid]="badPassword()" />
              <p id="password-hint" class="mt-1 text-xs" [class.text-red-600]="badPassword()" [class.text-slate-500]="!badPassword()">${PASSWORD_HINT}</p>
            </div>
            <div>
              <label for="confirm" class="label">Repeat new password</label>
              <input id="confirm" type="password" formControlName="confirm" class="input" autocomplete="new-password" [attr.aria-invalid]="mismatch()" />
              @if (mismatch()) {<p class="field-error">The passwords don't match.</p>}
            </div>
            @if (error()) {<p class="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ error() }}</p>}
            <button type="submit" class="btn-primary w-full py-3" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save new password' }}</button>
          </form>
        }
      </div>
    </div>
  `,
})
export class ResetPassword implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group(
    { password: ['', passwordRules], confirm: ['', Validators.required] },
    { validators: matching },
  );

  async ngOnInit() {
    await this.auth.ready; // the link signs the user in through Supabase before this page shows the form
  }

  protected badPassword = () => invalid(this.form.controls.password);
  protected mismatch = () => (this.form.hasError('mismatch') && this.form.controls.confirm.touched ? true : null);

  protected async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.updatePassword(this.form.controls.password.value);
      this.done.set(true);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
