import { Injectable, signal } from '@angular/core';

export interface ConfirmationOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface ConfirmationRequest extends Required<ConfirmationOptions> {
  message: string;
}

/**
 * Servicio para reemplazar las llamadas a `window.confirm()` con un modal estilizado.
 *
 * Uso:
 *   const confirmation = inject(ConfirmationService);
 *   const ok = await confirmation.ask('¿Eliminar este producto?', { danger: true });
 *   if (ok) { ... }
 */
@Injectable({ providedIn: 'root' })
export class ConfirmationService {
  private readonly _request = signal<ConfirmationRequest | null>(null);
  readonly request = this._request.asReadonly();
  private resolver: ((result: boolean) => void) | null = null;

  ask(message: string, options: ConfirmationOptions = {}): Promise<boolean> {
    // Si ya hay una confirmación abierta, la cancelamos antes.
    if (this.resolver) {
      this.resolver(false);
      this.resolver = null;
    }

    return new Promise(resolve => {
      this.resolver = resolve;
      this._request.set({
        message,
        title: options.title ?? 'Confirmar',
        confirmText: options.confirmText ?? 'Sí',
        cancelText: options.cancelText ?? 'Cancelar',
        danger: options.danger ?? false
      });
    });
  }

  resolve(result: boolean): void {
    if (this.resolver) {
      this.resolver(result);
      this.resolver = null;
    }
    this._request.set(null);
  }
}
