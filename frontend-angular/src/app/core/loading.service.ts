import { Injectable, signal } from '@angular/core';

/**
 * Servicio global de estado de carga. Cuenta cuántas peticiones HTTP están
 * pendientes en este momento. El `loading-bar` lo lee para mostrar/ocultar
 * la barra de progreso al tope de la aplicación.
 *
 * El conteo permite que múltiples requests simultáneas no apaguen la barra
 * antes de tiempo (sólo se apaga cuando TODAS terminan).
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private pending = 0;
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  start(): void {
    this.pending++;
    if (this.pending > 0) this._loading.set(true);
  }

  end(): void {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0) this._loading.set(false);
  }
}
