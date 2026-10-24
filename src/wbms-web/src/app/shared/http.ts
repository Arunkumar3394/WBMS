import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Adds the sign-in token to API calls and sends the user back to sign-in when it has expired. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const wasStaff = auth.isStaff();
  if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  return next(req).pipe(
    catchError((e: unknown) => {
      if (e instanceof HttpErrorResponse && e.status === 401 && token) {
        auth.signOut();
        router.navigateByUrl(wasStaff ? '/admin/login' : '/login');
      }
      return throwError(() => e);
    }),
  );
};

/** A sentence to show the user for a failed API call. */
export function errorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return "Can't reach the server. Check your internet connection.";
    if (e.status === 401) return 'Please sign in again.';
    if (e.status === 403) return "You don't have access to this.";
    if (e.status === 429) return 'Too many tries. Please wait a minute.';
    const body = e.error as { error?: string } | null;
    if (body && typeof body === 'object' && typeof body.error === 'string') return body.error;
    return 'Something went wrong. Please try again.';
  }
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
