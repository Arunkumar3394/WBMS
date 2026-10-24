import { Injectable, computed, signal } from '@angular/core';
import { SignedInUser, TokenResponse } from './models';

const KEY = 'wbms.session';

/** The signed-in user and their token, kept in localStorage so a refresh keeps you signed in. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private session = signal<TokenResponse | null>(this.load());

  readonly user = computed<SignedInUser | null>(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly isCustomer = computed(() => this.user()?.role === 'Customer');
  readonly isDriver = computed(() => this.user()?.role === 'Driver');
  readonly isStaff = computed(() => ['Admin', 'Staff'].includes(this.user()?.role ?? ''));
  readonly isAdmin = computed(() => this.user()?.role === 'Admin');

  signIn(t: TokenResponse) {
    this.session.set(t);
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode: session only */ }
  }

  signOut() {
    this.session.set(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  private load(): TokenResponse | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as TokenResponse) : null;
    } catch {
      return null;
    }
  }
}
