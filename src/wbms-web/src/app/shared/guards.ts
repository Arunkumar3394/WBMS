import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const customerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isCustomer()) return true;
  return inject(Router).parseUrl(auth.isStaff() ? '/admin' : auth.isDriver() ? '/driver' : '/login');
};

export const driverGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isDriver() ? true : inject(Router).parseUrl('/login');
};

export const staffGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isStaff() ? true : inject(Router).parseUrl('/admin/login');
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAdmin() ? true : inject(Router).parseUrl('/admin');
};
