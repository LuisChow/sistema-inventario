import { Injectable, signal } from '@angular/core';

export type NotificationKind = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: number;
  kind: NotificationKind;
  message: string;
  title?: string;
}

/**
 * Servicio centralizado de notificaciones (toasts).
 * Reemplaza el viejo hack de `window.alert` y los `alert()` dispersos.
 *
 * Uso:
 *   const notifications = inject(NotificationService);
 *   notifications.success('Producto guardado');
 *   notifications.error('No se pudo conectar');
 *   notifications.warning('Stock insuficiente');
 *   notifications.info('Sincronización en curso');
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly _notifications = signal<Notification[]>([]);
  readonly notifications = this._notifications.asReadonly();
  private nextId = 1;

  success(message: string, title?: string, duration = 3000): void {
    this.push('success', message, title, duration);
  }

  error(message: string, title?: string, duration = 6000): void {
    this.push('error', message, title, duration);
  }

  warning(message: string, title?: string, duration = 4500): void {
    this.push('warning', message, title, duration);
  }

  info(message: string, title?: string, duration = 3000): void {
    this.push('info', message, title, duration);
  }

  dismiss(id: number): void {
    this._notifications.update(list => list.filter(n => n.id !== id));
  }

  clear(): void {
    this._notifications.set([]);
  }

  private push(kind: NotificationKind, message: string, title: string | undefined, duration: number): void {
    const id = this.nextId++;
    this._notifications.update(list => [...list, { id, kind, message, title }]);
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
  }
}
