import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShortcutsService } from '../../core/shortcuts.service';

interface Shortcut {
  keys: string[];
  description: string;
}

@Component({
  selector: 'app-shortcuts-help',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (service.ayudaVisible()) {
      <div class="modal-overlay" (click)="service.ocultarAyuda()">
        <div class="modal-content shortcuts-card" (click)="$event.stopPropagation()">
          <h3 class="shortcuts-title">⌨️ Atajos de teclado</h3>

          <div class="shortcuts-section">
            <h4>Navegación</h4>
            <div class="shortcuts-list">
              @for (s of navegacion; track s.description) {
                <div class="shortcut">
                  <div class="keys">
                    @for (k of s.keys; track k) {
                      <kbd>{{ k }}</kbd>
                    }
                  </div>
                  <span class="desc">{{ s.description }}</span>
                </div>
              }
            </div>
          </div>

          <div class="shortcuts-section">
            <h4>Acciones</h4>
            <div class="shortcuts-list">
              @for (s of acciones; track s.description) {
                <div class="shortcut">
                  <div class="keys">
                    @for (k of s.keys; track k) {
                      <kbd>{{ k }}</kbd>
                    }
                  </div>
                  <span class="desc">{{ s.description }}</span>
                </div>
              }
            </div>
          </div>

          <div class="shortcuts-footer">
            Presiona <kbd>Esc</kbd> o <kbd>?</kbd> para cerrar
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .shortcuts-card {
      max-width: 540px;
      width: 90%;
    }
    .shortcuts-title {
      margin: 0 0 1.25rem 0;
      color: var(--accent);
    }
    .shortcuts-section {
      margin-bottom: 1.25rem;
    }
    .shortcuts-section h4 {
      margin: 0 0 0.6rem 0;
      font-size: 0.85rem;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.5px;
    }
    .shortcuts-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .shortcut {
      display: grid;
      grid-template-columns: 130px 1fr;
      align-items: center;
      gap: 12px;
    }
    .keys {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    kbd {
      display: inline-block;
      padding: 3px 8px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--text);
      box-shadow: 0 2px 0 var(--border);
      min-width: 18px;
      text-align: center;
    }
    .desc {
      color: var(--text);
      font-size: 0.95rem;
    }
    .shortcuts-footer {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  `]
})
export class ShortcutsHelp {
  public service = inject(ShortcutsService);

  navegacion: Shortcut[] = [
    { keys: ['Alt', '1'], description: 'Ir a Inicio' },
    { keys: ['Alt', '2'], description: 'Ir a Inventario' },
    { keys: ['Alt', '3'], description: 'Ir a Historial' },
    { keys: ['Alt', '4'], description: 'Ir a Configuración' }
  ];

  acciones: Shortcut[] = [
    { keys: ['/'], description: 'Enfocar el buscador (en Inventario o Historial)' },
    { keys: ['Esc'], description: 'Cerrar modal o diálogo' },
    { keys: ['Enter'], description: 'Confirmar diálogo abierto' },
    { keys: ['?'], description: 'Mostrar esta ayuda' }
  ];

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.service.ayudaVisible()) this.service.ocultarAyuda();
  }
}
