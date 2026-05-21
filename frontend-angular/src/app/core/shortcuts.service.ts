import { Injectable, signal } from '@angular/core';

/**
 * Estado del overlay de ayuda de atajos de teclado.
 * Lo usa `App` para alternar con la tecla "?" y el componente
 * `shortcuts-help` para mostrarse o esconderse.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly _ayudaVisible = signal(false);
  readonly ayudaVisible = this._ayudaVisible.asReadonly();

  toggleAyuda(): void { this._ayudaVisible.update(v => !v); }
  mostrarAyuda(): void { this._ayudaVisible.set(true); }
  ocultarAyuda(): void { this._ayudaVisible.set(false); }
}
