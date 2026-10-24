import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../shared/auth.service';

@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" routerLink="/admin">💧 WBMS Admin</a>
        <button class="navbar-toggler" type="button" (click)="open = !open" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
        <div class="collapse navbar-collapse" [class.show]="open">
          <ul class="navbar-nav me-auto" (click)="open = false">
            <li class="nav-item"><a class="nav-link" routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Dashboard</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/admin/orders" routerLinkActive="active">Orders</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/admin/customers" routerLinkActive="active">Customers</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/admin/drivers" routerLinkActive="active">Drivers</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/admin/products" routerLinkActive="active">Products &amp; stock</a></li>
            <li class="nav-item"><a class="nav-link" routerLink="/admin/reports" routerLinkActive="active">Reports</a></li>
            @if (auth.isAdmin()) {
              <li class="nav-item"><a class="nav-link" routerLink="/admin/staff" routerLinkActive="active">Staff</a></li>
            }
          </ul>
          <ul class="navbar-nav" (click)="open = false">
            <li class="nav-item"><a class="nav-link" routerLink="/admin/account" routerLinkActive="active">{{ auth.user()?.name }}</a></li>
            <li class="nav-item"><button class="btn btn-link nav-link" (click)="signOut()">Sign out</button></li>
          </ul>
        </div>
      </div>
    </nav>
    <main class="container-fluid py-4 px-lg-4">
      <router-outlet />
    </main>
  `,
})
export class AdminShell {
  auth = inject(AuthService);
  private router = inject(Router);
  open = false;

  signOut() {
    this.auth.signOut();
    this.router.navigateByUrl('/admin/login');
  }
}
