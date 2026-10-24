import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../shared/auth.service';

@Component({
  selector: 'app-driver-shell',
  imports: [RouterOutlet, RouterLink],
  template: `
    <nav class="navbar navbar-dark brand-bar">
      <div class="container">
        <a class="navbar-brand fw-semibold" routerLink="/driver">💧 Deliveries</a>
        <span class="navbar-text text-white small me-auto">{{ auth.user()?.name }}</span>
        <button class="btn btn-link nav-link text-white" (click)="signOut()">Sign out</button>
      </div>
    </nav>
    <main class="container py-3">
      <router-outlet />
    </main>
  `,
})
export class DriverShell {
  auth = inject(AuthService);
  private router = inject(Router);

  signOut() {
    this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
