import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, NotificationKind } from '../../core/notification.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      @for (n of notifications(); track n.id) {
        <div class="toast toast-{{ n.kind }}"
             (click)="service.dismiss(n.id)"
             role="alert">
          <div class="toast-icon">{{ icon(n.kind) }}</div>
          <div class="toast-body">
            @if (n.title) {
              <div class="toast-title">{{ n.title }}</div>
            }
            <div class="toast-message">{{ n.message }}</div>
          </div>
          <button class="toast-close"
                  (click)="service.dismiss(n.id); $event.stopPropagation()"
                  aria-label="Cerrar">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 90px;
      right: 24px;
      z-index: 100000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 400px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
      border-left: 5px solid var(--accent);
      border-radius: 10px;
      padding: 14px 18px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      animation: toastSlideIn 0.25s ease-out;
      min-width: 260px;
      backdrop-filter: blur(8px);
    }
    .toast-success { border-left-color: #2ec27e; }
    .toast-error   { border-left-color: #e5484d; }
    .toast-warning { border-left-color: #f5a524; }
    .toast-info    { border-left-color: var(--accent); }
    .toast-icon {
      font-size: 1.5rem;
      line-height: 1;
      flex-shrink: 0;
      padding-top: 2px;
    }
    .toast-success .toast-icon { color: #2ec27e; }
    .toast-error   .toast-icon { color: #e5484d; }
    .toast-warning .toast-icon { color: #f5a524; }
    .toast-info    .toast-icon { color: var(--accent); }
    .toast-body { flex: 1; min-width: 0; }
    .toast-title {
      font-weight: bold;
      margin-bottom: 4px;
      font-size: 1rem;
    }
    .toast-message {
      font-size: 0.95rem;
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .toast-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
      padding: 0 4px;
      flex-shrink: 0;
    }
    .toast-close:hover { color: var(--text); }
    @keyframes toastSlideIn {
      from { transform: translateX(30px); opacity: 0; }
      to   { transform: translateX(0);     opacity: 1; }
    }
  `]
})
export class Toast {
  public service = inject(NotificationService);
  notifications = this.service.notifications;

  icon(kind: NotificationKind): string {
    switch (kind) {
      case 'success': return '✓';
      case 'error':   return '✕';
      case 'warning': return '⚠';
      case 'info':    return 'ℹ';
    }
  }
}
