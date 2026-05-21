import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

/**
 * Datos de la empresa que aparecen en facturas impresas y configuración general.
 * Todas las propiedades son opcionales (la empresa puede no haber configurado nada).
 */
export interface EmpresaConfig {
  empresa_nombre?: string;
  empresa_rif?: string;
  empresa_direccion?: string;
  empresa_telefono?: string;
  empresa_email?: string;
  /** Imagen en formato data: URL (base64). */
  empresa_logo?: string;
  /** Mensaje opcional que aparece al final de cada factura. */
  empresa_mensaje?: string;
  /** Moneda principal mostrada en facturas ("USD" | "Bs"). */
  moneda_principal?: string;
}

export interface BackupInfo {
  nombre: string;
  tamanoBytes: number;
  fechaCreacion: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private http = inject(HttpClient);
  private apiBase = 'http://localhost:3000/api';

  // Estado reactivo (signals) — cualquier componente puede leer config() y
  // re-renderizar automáticamente cuando cambia.
  private readonly _config = signal<EmpresaConfig>({});
  readonly config = this._config.asReadonly();

  private readonly _backups = signal<BackupInfo[]>([]);
  readonly backups = this._backups.asReadonly();

  private cargado = false;

  /** Carga la configuración del backend si todavía no se ha cargado. */
  cargar(forzar = false): Observable<EmpresaConfig> {
    if (this.cargado && !forzar) {
      // Ya cargada, pero el caller puede querer un observable para encadenar
      return new Observable(sub => { sub.next(this._config()); sub.complete(); });
    }
    return this.http.get<EmpresaConfig>(`${this.apiBase}/configuracion`).pipe(
      tap(cfg => {
        this._config.set(cfg || {});
        this.cargado = true;
      })
    );
  }

  guardar(parche: Partial<EmpresaConfig>): Observable<{ mensaje: string }> {
    return this.http.put<{ mensaje: string }>(`${this.apiBase}/configuracion`, parche).pipe(
      tap(() => {
        // Mezclamos los cambios en el estado local sin re-llamar al backend
        this._config.update(actual => ({ ...actual, ...parche }));
      })
    );
  }

  // ===== RESPALDOS =====

  listarRespaldos(): Observable<BackupInfo[]> {
    return this.http.get<BackupInfo[]>(`${this.apiBase}/backups`).pipe(
      tap(lista => this._backups.set(lista))
    );
  }

  crearRespaldo(): Observable<BackupInfo> {
    return this.http.post<BackupInfo>(`${this.apiBase}/backup`, {}).pipe(
      tap(nuevo => {
        this._backups.update(lista => [nuevo, ...lista]);
      })
    );
  }

  eliminarRespaldo(nombre: string): Observable<unknown> {
    return this.http.delete(`${this.apiBase}/backups/${encodeURIComponent(nombre)}`).pipe(
      tap(() => {
        this._backups.update(lista => lista.filter(b => b.nombre !== nombre));
      })
    );
  }

  restaurarRespaldo(nombre: string): Observable<{ mensaje: string; requiereReinicio: boolean }> {
    return this.http.post<{ mensaje: string; requiereReinicio: boolean }>(
      `${this.apiBase}/restore`,
      { nombre }
    );
  }

  /** Formatea bytes a una unidad legible (KB, MB...). */
  static formatearTamano(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
