import { InjectionToken } from '@angular/core';

/**
 * Settings loaded at start-up from /config.json (git-ignored; see public/config.example.json),
 * so the same build can run against development and production.
 * None of these are secrets: the publishable key only allows what Row Level Security allows.
 */
export interface AppConfig {
  /** The AquaPure .NET API, e.g. https://api.example.com */
  apiBaseUrl: string;
  /** The Supabase project URL, or a proxy on your own domain that forwards to it. */
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('AppConfig');

export async function loadAppConfig(): Promise<AppConfig> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('config.json is missing. Copy public/config.example.json to public/config.json.');
  const config = (await response.json()) as AppConfig;
  for (const key of ['apiBaseUrl', 'supabaseUrl', 'supabasePublishableKey'] as const) {
    if (!config[key]) throw new Error(`config.json is missing "${key}".`);
  }
  return { ...config, apiBaseUrl: config.apiBaseUrl.replace(/\/+$/, '') };
}
