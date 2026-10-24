import { Injectable, computed, inject, signal } from '@angular/core';
import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

/** Signing in and out with Supabase Auth. The access token is sent to the API on every call. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabaseService = inject(SupabaseService);
  private sb = (): Promise<SupabaseClient> => this.supabaseService.client();

  readonly session = signal<Session | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly signedIn = computed(() => this.session() !== null);

  /** Resolves once the stored session (if any) has been loaded. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.sb().then(async (sb) => {
      sb.auth.onAuthStateChange((_event, session) => this.session.set(session));
      const { data } = await sb.auth.getSession();
      this.session.set(data.session);
    });
  }

  /** A current access token, refreshed by Supabase when it is about to expire. */
  async accessToken(): Promise<string | null> {
    // Visitors who never signed in: don't wait for the sign-in library to load.
    if (!this.session() && !hasStoredSession()) return null;
    await this.ready;
    const { data } = await (await this.sb()).auth.getSession();
    return data.session?.access_token ?? null;
  }

  /** After a 401 from the API: get a fresh token, or null if the session cannot be renewed. */
  async refresh(): Promise<string | null> {
    const { data, error } = await (await this.sb()).auth.refreshSession();
    if (error || !data.session) {
      await this.signOut();
      return null;
    }
    return data.session.access_token;
  }

  async signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await (await this.sb()).auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: location.origin + '/account' },
    });
    if (error) throw new Error(friendly(error));
    // With "Confirm email" on, Supabase returns no session until the link in the email is opened.
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await (await this.sb()).auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error));
  }

  async signOut(): Promise<void> {
    await (await this.sb()).auth.signOut();
    this.session.set(null);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await (await this.sb()).auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset-password' });
    if (error) throw new Error(friendly(error));
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await (await this.sb()).auth.updateUser({ password });
    if (error) throw new Error(friendly(error));
  }
}

/** Supabase keeps the session in localStorage as "sb-<project>-auth-token"; email links put it in the URL. */
function hasStoredSession(): boolean {
  try {
    if (/access_token=|code=/.test(location.hash + location.search)) return true;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) return true;
    }
  } catch {
    return true; // storage blocked: fall back to asking Supabase
  }
  return false;
}

/** Supabase Auth messages turned into plain language. */
function friendly(e: AuthError): string {
  switch (e.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Please confirm your email first: open the link we sent you.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Please sign in instead.';
    case 'weak_password':
      return 'Please choose a stronger password (at least 8 characters, with letters and numbers).';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'same_password':
      return 'Your new password must be different from the old one.';
    case 'signup_disabled':
      return 'New sign-ups are closed at the moment.';
  }
  if (e.status === 0 || /fetch/i.test(e.message)) return 'Cannot reach the sign-in service. Please check your internet connection.';
  return e.message || 'Something went wrong. Please try again.';
}
