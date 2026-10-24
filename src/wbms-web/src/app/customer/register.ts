import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { CustomerType } from '../shared/models';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="row justify-content-center">
      <div class="col-md-7 col-lg-6">
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <h1 class="h4 mb-1">Create your account</h1>
            <p class="text-body-secondary mb-4">Tell us where to deliver. You'll sign in with a code sent to your phone.</p>
            @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
            <form (ngSubmit)="save()">
              <div class="mb-3">
                <label class="form-label" for="name">Your name</label>
                <input id="name" class="form-control" name="name" [(ngModel)]="name" autocomplete="name" required />
              </div>
              <div class="mb-3">
                <label class="form-label" for="phone">Mobile number</label>
                <input id="phone" class="form-control" name="phone" [(ngModel)]="phone" inputmode="tel" autocomplete="tel" required />
              </div>
              <div class="mb-3">
                <label class="form-label d-block">This is a</label>
                <div class="btn-group" role="group">
                  @for (t of types; track t) {
                    <input type="radio" class="btn-check" name="type" [id]="'type-' + t" [value]="t" [(ngModel)]="type" />
                    <label class="btn btn-outline-primary" [for]="'type-' + t">{{ t }}</label>
                  }
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label" for="line">Delivery address</label>
                <input id="line" class="form-control" name="line" [(ngModel)]="addressLine" placeholder="Door no, street" autocomplete="street-address" required />
              </div>
              <div class="mb-4">
                <label class="form-label" for="area">Area</label>
                <input id="area" class="form-control" name="area" [(ngModel)]="area" placeholder="e.g. Anna Nagar" />
              </div>
              <button class="btn btn-primary btn-lg w-100" [disabled]="busy()">Create account</button>
            </form>
            <p class="mt-3 mb-0 text-center">Already have an account? <a routerLink="/login">Sign in</a></p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class Register {
  private api = inject(ApiService);
  private router = inject(Router);

  types: CustomerType[] = ['Home', 'Shop', 'Office'];
  name = '';
  phone = '';
  type: CustomerType = 'Home';
  addressLine = '';
  area = '';
  busy = signal(false);
  error = signal<string | null>(null);

  async save() {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.api.register({ name: this.name, phone: this.phone, type: this.type, addressLine: this.addressLine, area: this.area });
      this.router.navigate(['/login'], { queryParams: { phone: this.phone } });
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
