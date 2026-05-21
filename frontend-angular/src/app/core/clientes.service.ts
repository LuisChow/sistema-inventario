import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Cliente como lo devuelve y acepta el backend.
 * El campo `documento` actúa como identificador "natural" (cédula/RIF) y
 * es único cuando está presente. `id` lo asigna SQLite.
 */
export interface Cliente {
  id?: number;
  nombre: string;
  documento?: string;
  telefono?: string;
  direccion?: string;
  email?: string;
  fechaCreacion?: string;
  fechaActualizacion?: string;
}

/**
 * Acceso al endpoint de clientes. Actualmente lo usa la venta (de forma
 * implícita: el backend hace upsert al procesar la venta), pero queda
 * expuesto para futuras pantallas como "Listado de clientes",
 * "Autocompletar al cobrar", o "Reporte de cuentas por cliente".
 */
@Injectable({ providedIn: 'root' })
export class ClientesService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/clientes';

  listar(): Observable<Cliente[]> {
    return this.http.get<Cliente[]>(this.apiUrl);
  }

  /** Búsqueda por nombre o documento. Útil para un autocomplete. */
  buscar(q: string): Observable<Cliente[]> {
    const params = new HttpParams().set('q', q);
    return this.http.get<Cliente[]>(this.apiUrl, { params });
  }

  obtener(id: number): Observable<Cliente> {
    return this.http.get<Cliente>(`${this.apiUrl}/${id}`);
  }

  crearOActualizar(cliente: Cliente): Observable<Cliente> {
    return this.http.post<Cliente>(this.apiUrl, cliente);
  }

  actualizar(id: number, cliente: Cliente): Observable<{ mensaje: string }> {
    return this.http.put<{ mensaje: string }>(`${this.apiUrl}/${id}`, cliente);
  }

  eliminar(id: number): Observable<{ mensaje: string }> {
    return this.http.delete<{ mensaje: string }>(`${this.apiUrl}/${id}`);
  }
}
