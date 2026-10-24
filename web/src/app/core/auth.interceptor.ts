import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { APP_CONFIG } from './app-config';
import { AuthService } from './auth.service';

/** Adds "Authorization: Bearer <token>" to AquaPure API calls, and retries once with a fresh token after a 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(APP_CONFIG).apiBaseUrl;
  if (!req.url.startsWith(api)) return next(req);

  const auth = inject(AuthService);
  const withToken = (token: string | null) => (token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);

  return from(auth.accessToken()).pipe(
    switchMap((token) =>
      next(withToken(token)).pipe(
        catchError((err) => {
          if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !token) return throwError(() => err);
          return from(auth.refresh()).pipe(switchMap((fresh) => (fresh ? next(withToken(fresh)) : throwError(() => err))));
        }),
      ),
    ),
  );
};
