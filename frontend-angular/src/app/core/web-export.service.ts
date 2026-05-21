import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { InventoryService, Repuesto } from './inventory';

/**
 * Producto en el formato que espera Tienda-Web. Lo derivamos transformando
 * cada Repuesto del inventario.
 */
export interface ProductoWeb {
  codigo: string;
  nombre: string;
  descripcion?: string;
  categoria: string;
  precio: number;
  precioBs?: number;
  stock: number;
  fotoUrl?: string;
  disponible: boolean;
  destacado?: boolean;
}

/**
 * Servicio de exportación de catálogo al sitio web.
 *
 * Dos modos:
 *  - `descargarJson()`: genera productos.json y dispara descarga al disco del usuario.
 *    El dueño sube el archivo manualmente a su hosting (modo estático, $0).
 *
 *  - `subirAlCloud(url, apiKey)`: hace POST al endpoint de sincronización del
 *    backend de Tienda-Web. Sincronización automática (modo cloud, $$).
 */
@Injectable({ providedIn: 'root' })
export class WebExportService {
  private http = inject(HttpClient);
  private inventario = inject(InventoryService);

  /**
   * Convierte los repuestos del inventario al formato Producto que espera
   * la tienda web. Por default sólo incluye productos con stock > 0.
   */
  generarProductos(soloDisponibles = true): ProductoWeb[] {
    const lista: Repuesto[] = this.inventario.inventarioActual;
    const tasa = this.inventario.tasaCambio || 0;
    const fuente = soloDisponibles ? lista.filter(r => r.cantidad > 0) : lista;
    return fuente.map(r => ({
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: '',
      categoria: r.categoria,
      precio: Number(r.precioVenta) || 0,
      precioBs: tasa > 0 ? Number(r.precioVenta) * tasa : undefined,
      stock: Number(r.cantidad) || 0,
      fotoUrl: undefined,
      disponible: r.cantidad > 0
    }));
  }

  /**
   * Descarga el archivo productos.json al disco del usuario. El dueño después
   * lo sube manualmente a su hosting.
   */
  descargarJson(soloDisponibles = true): number {
    const productos = this.generarProductos(soloDisponibles);
    const json = JSON.stringify(productos, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'productos.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return productos.length;
  }

  /**
   * Sincroniza con el backend cloud. Llama a POST {apiUrl}/api/productos/sync
   * con el array de productos. Si apiKey está presente, lo manda en el header
   * X-Admin-Key (el backend del web lo requiere si tiene ADMIN_KEY configurada).
   */
  subirAlCloud(apiUrl: string, apiKey: string, soloDisponibles = true): Observable<unknown> {
    const productos = this.generarProductos(soloDisponibles);
    const url = apiUrl.replace(/\/$/, '') + '/api/productos/sync';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Admin-Key'] = apiKey;
    return this.http.post(url, productos, { headers });
  }
}
