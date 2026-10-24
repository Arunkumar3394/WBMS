import { Component, computed, input } from '@angular/core';
import { OrderStatus } from './models';
import { STATUS_TEXT, statusColor } from './format';

@Component({
  selector: 'app-status',
  template: `<span class="badge rounded-pill text-bg-{{ color() }}">{{ staff() ? status() : text() }}</span>`,
})
export class StatusBadge {
  status = input.required<OrderStatus>();
  /** Staff see the raw status name; customers see a friendly sentence. */
  staff = input(false);
  text = computed(() => STATUS_TEXT[this.status()]);
  color = computed(() => statusColor(this.status()));
}
