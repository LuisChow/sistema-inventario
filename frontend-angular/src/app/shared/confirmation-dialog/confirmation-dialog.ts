import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmationService } from '../../core/confirmation.service';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (request(); as r) {
      <div class="modal-overlay" (click)="service.resolve(false)">
        <div class="modal-content confirm-card" (click)="$event.stopPropagation()">
          <h3 class="confirm-title" [class.danger]="r.danger">
            {{ r.danger ? '⚠️ ' : '' }}{{ r.title }}
          </h3>
          <p class="confirm-message">{{ r.message }}</p>
          <div class="confirm-actions">
            <button class="btn-cancel" (click)="service.resolve(false)">
              {{ r.cancelText }}
            </button>
            <button class="btn-confirm" [class.danger]="r.danger" (click)="service.resolve(true)">
              {{ r.confirmText }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .confirm-card { max-width: 460px; }
    .confirm-title {
      margin-top: 0;
      margin-bottom: 12px;
      color: var(--accent);
    }
    .confirm-title.danger { color: #e5484d; }
    .confirm-message {
      font-size: 1.05rem;
      line-height: 1.5;
      white-space: pre-wrap;
      margin-bottom: 24px;
    }
    .confirm-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .btn-cancel,
    .btn-confirm {
      padding: 10px 22px;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
      font-size: 1rem;
    }
    .btn-cancel {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
    }
    .btn-cancel:hover { background: var(--bg-hover); }
    .btn-confirm {
      border: none;
      background: var(--accent);
      color: white;
    }
    .btn-confirm.danger { background: #e5484d; }
    .btn-confirm:hover { filter: brightness(1.1); }
  `]
})
export class ConfirmationDialog {
  public service = inject(ConfirmationService);
  request = this.service.request;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.request()) this.service.resolve(false);
  }

  @HostListener('document:keydown.enter')
  onEnter(): void {
    if (this.request()) this.service.resolve(true);
  }
}
