import { Component, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from './core/inventory';
import { ShortcutsService } from './core/shortcuts.service';
import { MainView } from './features/dashboard/main-view/main-view';
import { Toast } from './shared/toast/toast';
import { ConfirmationDialog } from './shared/confirmation-dialog/confirmation-dialog';
import { LoadingBar } from './shared/loading-bar/loading-bar';
import { ShortcutsHelp } from './shared/shortcuts-help/shortcuts-help';

const VISTAS_VALIDAS = ['inicio', 'inventario', 'historial', 'configuracion'] as const;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MainView, Toast, ConfirmationDialog, LoadingBar, ShortcutsHelp],
  templateUrl: './app.html'
})
export class App implements OnInit {
  public inventoryService = inject(InventoryService);
  private shortcuts = inject(ShortcutsService);

  temaActual: string = 'dark';

  ngOnInit() {
    const temaGuardado = localStorage.getItem('temaApp');
    this.cambiarTema(temaGuardado || 'dark');
  }

  cambiarTema(nuevoTema: string) {
    this.temaActual = nuevoTema;
    document.body.className = nuevoTema;
    localStorage.setItem('temaApp', nuevoTema);
  }

  /**
   * Atajos globales de teclado. Alt+1..4 navegan entre vistas; "/" enfoca
   * el buscador del listado actual; "?" muestra/oculta la ayuda.
   */
  @HostListener('document:keydown', ['$event'])
  onGlobalKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const editable =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    // Alt+N navega siempre, incluso si estás escribiendo (atajo "fuerte")
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const idx = '1234'.indexOf(e.key);
      if (idx !== -1) {
        this.inventoryService.vistaActual = VISTAS_VALIDAS[idx];
        e.preventDefault();
        return;
      }
    }

    // El resto sólo cuando NO estás escribiendo
    if (editable) return;

    if (e.key === '/') {
      const buscador = document.querySelector<HTMLInputElement>('.search-box');
      if (buscador) {
        buscador.focus();
        buscador.select();
        e.preventDefault();
      }
      return;
    }

    if (e.key === '?') {
      this.shortcuts.toggleAyuda();
      e.preventDefault();
      return;
    }
  }
}
