import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../shared/auth.service';

@Component({
  selector: 'app-customer-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="navbar navbar-dark brand-bar">
      <div class="container flex-wrap">
        <a class="navbar-brand fw-semibold" routerLink="/">💧 WBMS Water</a>
        @if (auth.isCustomer()) {
          <ul class="navbar-nav flex-row gap-3 customer-nav">
            <li class="nav-item"><a class="nav-link" routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Book</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/orders" routerLinkActive="active">Orders</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/account" routerLinkActive="active">Account</a></li>
            <li class="nav-item"><button class="btn btn-link nav-link" (click)="signOut()">Sign out</button></li>
          </ul>
        }
      </div>
    </nav>
    <main class="container py-4">
      <router-outlet />
    </main>
  `,
})
export class CustomerShell {
  auth = inject(AuthService);
  private router = inject(Router);

  signOut() {
    this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
