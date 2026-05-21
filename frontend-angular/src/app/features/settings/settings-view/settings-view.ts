import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigService, EmpresaConfig, BackupInfo } from '../../../core/config.service';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmationService } from '../../../core/confirmation.service';

type Tab = 'empresa' | 'respaldos';

@Component({
  selector: 'app-settings-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-view.html',
  styleUrl: './settings-view.css'
})
export class SettingsView implements OnInit {
  private config = inject(ConfigService);
  private notifications = inject(NotificationService);
  private confirmation = inject(ConfirmationService);

  tabActiva: Tab = 'empresa';

  empresa: EmpresaConfig = {};
  guardando = false;

  respaldos = this.config.backups;
  creandoRespaldo = false;

  /** Expone el helper estático para usarlo desde el template. */
  formatearTamano = ConfigService.formatearTamano;

  ngOnInit(): void {
    this.config.cargar().subscribe(cfg => {
      this.empresa = { ...cfg };
    });
    this.config.listarRespaldos().subscribe();
  }

  cambiarTab(t: Tab): void {
    this.tabActiva = t;
  }

  guardarEmpresa(): void {
    if (this.guardando) return;
    this.guardando = true;
    this.config.guardar(this.empresa).subscribe({
      next: () => {
        this.notifications.success('Configuración guardada.');
        this.guardando = false;
      },
      error: () => { this.guardando = false; }
    });
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      this.notifications.warning('El logo es muy grande (máximo 500 KB).');
      input.value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.notifications.warning('Selecciona un archivo de imagen.');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.empresa.empresa_logo = reader.result as string;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  quitarLogo(): void {
    this.empresa.empresa_logo = '';
  }

  crearRespaldo(): void {
    if (this.creandoRespaldo) return;
    this.creandoRespaldo = true;
    this.config.crearRespaldo().subscribe({
      next: (b) => {
        this.notifications.success(`Respaldo creado: ${b.nombre}`);
        this.creandoRespaldo = false;
      },
      error: () => { this.creandoRespaldo = false; }
    });
  }

  async eliminarRespaldo(b: BackupInfo): Promise<void> {
    const ok = await this.confirmation.ask(
      `¿Eliminar el respaldo "${b.nombre}"? Esta acción no se puede deshacer.`,
      { title: 'Eliminar respaldo', danger: true, confirmText: 'Eliminar' }
    );
    if (!ok) return;
    this.config.eliminarRespaldo(b.nombre).subscribe(() => {
      this.notifications.success('Respaldo eliminado.');
    });
  }

  async restaurarRespaldo(b: BackupInfo): Promise<void> {
    const fechaFmt = new Date(b.fechaCreacion).toLocaleString('es-VE');
    const ok = await this.confirmation.ask(
      `Al restaurar este respaldo, se PERDERÁN todos los cambios hechos después del ${fechaFmt}.\n\nLa restauración se aplica al cerrar y volver a abrir la aplicación.\n\n¿Continuar?`,
      { title: 'Restaurar respaldo', danger: true, confirmText: 'Programar restauración' }
    );
    if (!ok) return;
    this.config.restaurarRespaldo(b.nombre).subscribe(res => {
      this.notifications.info(
        res.mensaje,
        'Restauración programada',
        12000
      );
    });
  }
}
