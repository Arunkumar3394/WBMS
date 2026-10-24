import { Pipe, PipeTransform } from '@angular/core';

const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** ₹1,250 or ₹1,250.50: decimals only when there are paise. */
export function formatRupees(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? whole.format(n) : paise.format(n);
}

@Pipe({ name: 'rupees' })
export class RupeesPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatRupees(value);
  }
}
