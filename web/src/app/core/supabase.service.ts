import { Injectable, inject } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from './app-config';

/**
 * Supabase is used from the browser only for signing in (email + password; phone codes later)
 * and for admins uploading product images. All other data goes through the AquaPure API.
 * The library is loaded on first use so it does not slow down the first page load.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly config = inject(APP_CONFIG);
  private clientPromise?: Promise<SupabaseClient>;

  client(): Promise<SupabaseClient> {
    return (this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient, processLock }) =>
      createClient(this.config.supabaseUrl, this.config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // An in-page lock instead of the browser's Navigator Locks, which can time out under Angular.
          lock: processLock,
        },
      }),
    ));
  }
}
