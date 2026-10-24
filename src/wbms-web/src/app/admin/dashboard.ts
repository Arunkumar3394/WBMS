import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../shared/api.service';
import { errorMessage } from '../shared/http';
import { Dashboard as Stats } from '../shared/models';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DecimalPipe],
  template: `
    <h1 class="h4 mb-3">Today</h1>
    @if (error()) { <div class="alert alert-danger py-2">{{ error() }}</div> }
    @if (s(); as s) {
      <div class="row g-3">
        <div class="col-6 col-lg-3"><a class="stat card text-decoration-none" routerLink="/admin/orders" [queryParams]="{ status: 'new' }"><div class="card-body">
          <div class="stat-label">New orders to confirm</div><div class="stat-value" [class.text-warning]="s.toConfirm > 0">{{ s.toConfirm }}</div></div></a></div>
        <div class="col-6 col-lg-3"><a class="stat card text-decoration-none" routerLink="/admin/orders" [queryParams]="{ status: 'Confirmed' }"><div class="card-body">
          <div class="stat-label">Waiting for a driver</div><div class="stat-value">{{ s.toAssign }}</div></div></a></div>
        <div class="col-6 col-lg-3"><a class="stat card text-decoration-none" routerLink="/admin/orders" [queryParams]="{ status: 'OutForDelivery' }"><div class="card-body">
          <div class="stat-label">Out for delivery</div><div class="stat-value">{{ s.outForDelivery }}</div></div></a></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body">
          <div class="stat-label">Delivered today</div><div class="stat-value">{{ s.deliveredToday }}</div></div></div></div>
        <div class="col-6 col-lg-3"><div class="stat card"><div class="card-body">
          <div class="stat-label">Sales today (₹)</div><div class="stat-value">{{ s.salesToday | number: '1.0-0' }}</div></div></div></div>
        <div class="col-6 col-lg-3"><a class="stat card text-decoration-none" routerLink="/admin/customers"><div class="card-body">
          <div class="stat-label">Customer dues (₹)</div><div class="stat-value">{{ s.dues | number: '1.0-0' }}</div></div></a></div>
        <div class="col-6 col-lg-3"><a class="stat card text-decoration-none" routerLink="/admin/customers"><div class="card-body">
          <div class="stat-label">Cans with customers</div><div class="stat-value">{{ s.cansOut }}</div></div></a></div>
        <div class="col-6 col-lg-3"><a class="stat card text-decoration-none" routerLink="/admin/products"><div class="card-body">
          <div class="stat-label">Full cans in stock</div><div class="stat-value">{{ s.fullStock }}</div></div></a></div>
      </div>
    }
  `,
})
export class Dashboard {
  s = signal<Stats | null>(null);
  error = signal<string | null>(null);
  constructor() {
    inject(ApiService).dashboard().then((s) => this.s.set(s), (e) => this.error.set(errorMessage(e)));
  }
}
