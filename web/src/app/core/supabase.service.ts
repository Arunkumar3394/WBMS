import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from './app-config';

/**
 * Supabase is used from the browser only for signing in (email + password or phone code)
 * and for admins uploading product images. All other data goes through the AquaPure API.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly config = inject(APP_CONFIG);

  readonly client: SupabaseClient = createClient(this.config.supabaseUrl, this.config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
