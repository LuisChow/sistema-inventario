import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, tap } from 'rxjs';
import { NotificationService } from './notification.service';
import { CartService, ItemCarrito } from './cart.service';

export interface Repuesto {
  codigo: string; nombre: string; categoria: string; cantidad: number;
  precioCompra: number; precioVenta: number; precioCompraBs?: number;
}

export interface Movimiento {
  id?: number; fecha: Date; codigoProducto: string; nombreProducto: string;
  tipo: string; cantidad: number; descripcion: string; valorTotalUsd: number;
  gananciaUsd: number; valorTotalBs: number; gananciaBs: number; facturaId?: string;
  clienteNombre?: string; clienteDocumento?: string; clienteTelefono?: string;
  clienteDireccion?: string; metodoPago?: string; estadoPago?: string;
  /**
   * JSON serializado con la forma `{ old: Partial<Repuesto>, new: Partial<Repuesto> }`
   * para los campos que cambiaron en la edicion. Permite que la anulacion
   * revierta el producto a su estado anterior.
   */
  metadatos?: string;
}

/** Re-export para que componentes existentes sigan importando desde `inventory`. */
export type { ItemCarrito };

/** Datos del cliente y método de pago pasados al procesar una venta. */
export interface ClienteInfoVenta {
  nombre: string;
  documento: string;
  telefono: string;
  direccion: string;
  metodoPago: 'Contado' | 'Credito';
  pagoInicial: number;
}

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private apiBase = 'http://localhost:3000/api';
  private apiUrl = `${this.apiBase}/repuestos`;
  private apiMovimientosUrl = `${this.apiBase}/movimientos`;
  private apiVentasUrl = `${this.apiBase}/ventas`;
  private apiTasasUrl = `${this.apiBase}/tasas`;

  private _tasaCambio: number = 0;
  private tasaSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  mesDashboard: string = '';
  vistaActual: string = 'inicio';

  private inventarioSubject = new BehaviorSubject<Repuesto[]>([]);
  public inventario$ = this.inventarioSubject.asObservable();

  private movimientosSubject = new BehaviorSubject<Movimiento[]>([]);
  public movimientos$ = this.movimientosSubject.asObservable();

  public categorias: string[] = [];
  public categoriasSubject = new BehaviorSubject<string[]>([]);
  public categorias$ = this.categoriasSubject.asObservable();

  private facturasAnuladas: Set<string> = new Set();
  private notifications = inject(NotificationService);
  private cart = inject(CartService);

  constructor(private http: HttpClient) {
    const tasaGuardada = localStorage.getItem('tasaCambio');
    if (tasaGuardada) this._tasaCambio = parseFloat(tasaGuardada);
    const hoy = new Date();
    this.mesDashboard = `${hoy.getFullYear()}-${(hoy.getMonth() + 1).toString().padStart(2, '0')}`;
    this.cargarCategoriasDesdeBD();
    this.cargarRepuestosDesdeBD();
    this.cargarMovimientosDesdeBD();
    this.cargarTasaLatest();
  }

  get tasaCambio(): number { return this._tasaCambio; }
  set tasaCambio(valor: number) {
    this._tasaCambio = valor;
    localStorage.setItem('tasaCambio', valor.toString());
    this.programarGuardadoTasa(valor);
  }

  /**
   * Carga la última tasa de cambio guardada en el backend. Si la BD tiene
   * una tasa, gana sobre el localStorage (la BD es la fuente de verdad).
   * Si la BD está vacía pero local tiene un valor, lo subimos para inicializar.
   */
  private cargarTasaLatest(): void {
    this.http.get<{ valor: number; fecha: string } | null>(`${this.apiTasasUrl}/latest`).subscribe({
      next: row => {
        if (row && typeof row.valor === 'number' && row.valor > 0) {
          this._tasaCambio = row.valor;
          localStorage.setItem('tasaCambio', String(row.valor));
        } else if (this._tasaCambio > 0) {
          // BD vacía pero tenemos un valor local — lo subimos para inicializar el historial
          this.http.post(this.apiTasasUrl, { valor: this._tasaCambio }).subscribe();
        }
      },
      error: () => { /* tolerate; el interceptor ya notificó al usuario */ }
    });
  }

  /**
   * Guarda la tasa en el backend con debounce de 1.5 segundos para no
   * spammear la BD mientras el usuario está tipeando el número.
   */
  private programarGuardadoTasa(valor: number): void {
    if (this.tasaSaveTimeout) clearTimeout(this.tasaSaveTimeout);
    this.tasaSaveTimeout = setTimeout(() => {
      // Si el usuario siguió cambiando, sólo guardamos el valor "final"
      if (valor > 0 && Math.abs(this._tasaCambio - valor) < 0.0001) {
        this.http.post(this.apiTasasUrl, { valor }).subscribe();
      }
    }, 1500);
  }
  public get inventarioActual(): Repuesto[] { return this.inventarioSubject.value; }
  public get movimientosActuales(): Movimiento[] { return this.movimientosSubject.value; }

  getIdentificador(m: Movimiento): string {
    return m.facturaId ? m.facturaId : `MOV-${m.id || new Date(m.fecha).getTime()}`;
  }

  cargarRepuestosDesdeBD() { this.http.get<Repuesto[]>(this.apiUrl).subscribe(d => this.inventarioSubject.next(d)); }
  
  cargarMovimientosDesdeBD() { 
    this.http.get<any[]>(this.apiMovimientosUrl).subscribe(d => {
      const movs = d.map(m => ({ ...m, fecha: new Date(m.fecha) }));
      this.facturasAnuladas = new Set(movs.filter(m => m.tipo === 'Anulacion').map(m => m.facturaId));
      this.movimientosSubject.next(movs);
    }); 
  }
  
  cargarCategoriasDesdeBD() { this.http.get<string[]>(this.apiUrl.replace('/repuestos', '/categorias')).subscribe(d => { this.categorias = d; this.categoriasSubject.next([...this.categorias]); }); }

  esAnulado(m: Movimiento): boolean { return this.facturasAnuladas.has(this.getIdentificador(m)); }

  agregarRepuesto(nuevo: Repuesto) {
    nuevo.codigo = nuevo.codigo.trim();
    nuevo.nombre = nuevo.nombre.trim();
    if (!nuevo.categoria) {
      this.notifications.warning('Selecciona o crea una categoría.');
      return;
    }
    if (this.inventarioActual.some(r => r.codigo.toLowerCase() === nuevo.codigo.toLowerCase())) {
      this.notifications.error(`El código "${nuevo.codigo}" ya existe.`, 'Código duplicado');
      return;
    }

    this.inventarioSubject.next([...this.inventarioActual, nuevo]);
    this.http.post(this.apiUrl, nuevo).subscribe({
      next: () => {
        this.cargarRepuestosDesdeBD(); 
        this.registrarMovimiento({
          fecha: new Date(), codigoProducto: nuevo.codigo, nombreProducto: nuevo.nombre,
          tipo: 'Entrada', cantidad: nuevo.cantidad, descripcion: 'Registro Inicial',
          valorTotalUsd: nuevo.cantidad * nuevo.precioCompra, gananciaUsd: 0,
          valorTotalBs: (nuevo.cantidad * nuevo.precioCompra) * this.tasaCambio, gananciaBs: 0,
          facturaId: `INIT-${Date.now()}`
        });
      }
    });
  }

  editarRepuesto(repuestoActualizado: Repuesto, repuestoViejo: Repuesto, desc: string = '', valorMovimientoUsd?: number, valorMovimientoBs?: number) {
    const inventarioClon = [...this.inventarioActual];
    const idx = inventarioClon.findIndex(r => r.codigo === repuestoActualizado.codigo);
    if (idx !== -1) { inventarioClon[idx] = repuestoActualizado; this.inventarioSubject.next(inventarioClon); }

    this.http.put(`${this.apiUrl}/${repuestoActualizado.codigo}`, repuestoActualizado).subscribe(() => {
      this.cargarRepuestosDesdeBD();
      const cantVieja = Number(repuestoViejo.cantidad || 0);
      const cantNueva = Number(repuestoActualizado.cantidad);
      const diff = cantNueva - cantVieja;

      // Construimos un JSON con old/new para los campos que cambiaron (excepto cantidad,
      // que ya queda registrada por el delta de Entrada/Salida). Esto permite revertir
      // el cambio limpio al anular la operación. Lo adjuntamos al movimiento como `metadatos`.
      const metadatos = this.construirMetadatosCambio(repuestoViejo, repuestoActualizado);

      if (diff !== 0) {
        const esEntrada = diff > 0;
        const cant = Math.abs(diff);
        const totalUsd = valorMovimientoUsd !== undefined ? valorMovimientoUsd : cant * Number(repuestoActualizado.precioCompra);
        const totalBs = valorMovimientoBs !== undefined ? valorMovimientoBs : cant * (repuestoActualizado.precioCompraBs || 0);

        this.registrarMovimiento({
          fecha: new Date(), codigoProducto: repuestoActualizado.codigo, nombreProducto: repuestoActualizado.nombre,
          tipo: esEntrada ? 'Entrada' : 'Salida', cantidad: cant,
          descripcion: desc || (esEntrada ? 'Ajuste (Entrada)' : 'Avería / Pérdida'),
          valorTotalUsd: totalUsd, gananciaUsd: 0,
          valorTotalBs: totalBs, gananciaBs: 0,
          facturaId: `AJUS-${Date.now()}`,
          metadatos
        });
      } else {
        const cambios: string[] = [];
        if (repuestoViejo.precioCompra !== repuestoActualizado.precioCompra) cambios.push(`Costo: $${repuestoViejo.precioCompra} ➝ $${repuestoActualizado.precioCompra}`);
        if (repuestoViejo.precioVenta !== repuestoActualizado.precioVenta) cambios.push(`Venta: $${repuestoViejo.precioVenta} ➝ $${repuestoActualizado.precioVenta}`);
        if (repuestoViejo.categoria !== repuestoActualizado.categoria) cambios.push(`Cat: ${repuestoViejo.categoria} ➝ ${repuestoActualizado.categoria}`);
        if (repuestoViejo.nombre !== repuestoActualizado.nombre) cambios.push(`Nombre Editado`);

        if (cambios.length > 0) {
          this.registrarMovimiento({
            fecha: new Date(), codigoProducto: repuestoActualizado.codigo, nombreProducto: repuestoActualizado.nombre,
            tipo: 'Modificacion', cantidad: 0,
            descripcion: (desc ? `${desc} | ` : 'Modificación: ') + cambios.join(' | '),
            valorTotalUsd: 0, gananciaUsd: 0, valorTotalBs: 0, gananciaBs: 0,
            facturaId: `MOD-${Date.now()}`,
            metadatos
          });
        }
      }
    });
  }

  /**
   * Construye el JSON `metadatos` para un movimiento de edición, capturando
   * old/new de cada campo que cambió (excepto `cantidad`, que ya se refleja
   * en el delta de la Entrada/Salida). Devuelve `undefined` si no hubo cambios
   * de campos (en cuyo caso el movimiento no necesita metadatos).
   */
  private construirMetadatosCambio(viejo: Repuesto, nuevo: Repuesto): string | undefined {
    const old: Partial<Repuesto> = {};
    const nue: Partial<Repuesto> = {};
    const campos: (keyof Repuesto)[] = ['precioCompra', 'precioCompraBs', 'precioVenta', 'categoria', 'nombre'];
    for (const c of campos) {
      if (viejo[c] !== nuevo[c]) {
        (old as Record<string, unknown>)[c] = viejo[c];
        (nue as Record<string, unknown>)[c] = nuevo[c];
      }
    }
    return Object.keys(old).length > 0 ? JSON.stringify({ old, new: nue }) : undefined;
  }

  actualizarRepuestoSilencioso(repuestoActualizado: Repuesto) {
    const inventarioClon = [...this.inventarioActual];
    const idx = inventarioClon.findIndex(r => r.codigo === repuestoActualizado.codigo);
    if (idx !== -1) { inventarioClon[idx] = repuestoActualizado; this.inventarioSubject.next(inventarioClon); }
    this.http.put(`${this.apiUrl}/${repuestoActualizado.codigo}`, repuestoActualizado).subscribe(() => {
      this.cargarRepuestosDesdeBD(); 
    });
  }

  /**
   * Borra un producto en el backend. El servidor hace cascade delete de
   * los movimientos no-venta asociados, o devuelve 409 si el producto
   * tiene ventas reales registradas (en cuyo caso no se borra nada).
   *
   * Devuelve un Observable para que el componente sepa cuándo se completó
   * (o falló) la operación y muestre el toast en el momento correcto.
   */
  eliminarRepuesto(c: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${c}`).pipe(
      tap(() => {
        this.cargarRepuestosDesdeBD();
        // El cascade tambien pudo borrar movimientos, asi que recargamos
        // los movimientos para refrescar el dashboard.
        this.cargarMovimientosDesdeBD();
      })
    );
  }
  eliminarFactura(facturaId: string) { this.http.delete(`${this.apiMovimientosUrl}/factura/${facturaId}`).subscribe(() => this.cargarMovimientosDesdeBD()); }
  registrarMovimiento(m: Movimiento) { this.http.post(this.apiMovimientosUrl, m).subscribe(() => this.cargarMovimientosDesdeBD()); }

  agregarCategoria(n: string) {
    const limpia = n.trim(); if (!limpia || this.categorias.includes(limpia)) return;
    this.http.post(this.apiUrl.replace('/repuestos', '/categorias'), { nombre: limpia }).subscribe(() => this.cargarCategoriasDesdeBD());
  }
  eliminarCategoria(n: string) { this.http.delete(`${this.apiUrl.replace('/repuestos', '/categorias')}/${n}`).subscribe(() => this.cargarCategoriasDesdeBD()); }

  /**
   * Procesa la venta completa del carrito en una sola llamada atómica.
   * El backend ejecuta todo dentro de una transacción SQL: si cualquier paso
   * falla (stock insuficiente, error de red...), nada se aplica.
   *
   * Devuelve un Observable para que el componente sepa cuándo la venta
   * realmente terminó y pueda mostrar el toast de éxito en el momento correcto.
   */
  procesarVentaCarrito(info: ClienteInfoVenta): Observable<unknown> {
    const items = this.cart.items;
    if (items.length === 0) return of(null);

    const facturaId = 'FACT-' + Date.now();
    const tasa = this.tasaCambio;

    const payload = {
      facturaId,
      fecha: new Date().toISOString(),
      items: items.map(i => {
        const r = i.producto;
        const valorVentaUsd = i.cantidadVendida * r.precioVenta;
        const valorVentaBs = valorVentaUsd * tasa;
        const costoTotalUsd = i.cantidadVendida * r.precioCompra;
        const costoTotalBs = i.cantidadVendida * (r.precioCompraBs || 0);
        return {
          codigo: r.codigo,
          nombreProducto: r.nombre,
          cantidad: i.cantidadVendida,
          valorTotalUsd: valorVentaUsd,
          gananciaUsd: valorVentaUsd - costoTotalUsd,
          valorTotalBs: valorVentaBs,
          gananciaBs: valorVentaBs - costoTotalBs
        };
      }),
      clienteNombre: info.nombre,
      clienteDocumento: info.documento || '',
      clienteTelefono: info.telefono || '',
      clienteDireccion: info.direccion || '',
      metodoPago: info.metodoPago || 'Contado',
      pagoInicial: Number(info.pagoInicial) || 0,
      tasaCambio: tasa
    };

    return this.http.post(this.apiVentasUrl, payload).pipe(
      tap(() => {
        this.cargarRepuestosDesdeBD();
        this.cargarMovimientosDesdeBD();
        this.cart.vaciarCarrito();
      })
    );
  }

  get totalProductos(): number { return this.inventarioActual.length; } 
  get bajoStock(): number { return this.inventarioActual.filter(i => i.cantidad <= 5).length; } 
  get inversionTotalCat(): number { return this.inventarioActual.reduce((t, i) => t + (i.cantidad * i.precioCompra), 0); }
  get inversionTotalCatBs(): number { return this.inventarioActual.reduce((t, i) => t + (i.cantidad * (i.precioCompraBs || 0)), 0); }
  private esMesDashboard(f: Date): boolean { const d = this.mesDashboard.split('-'); return f.getFullYear() === +d[0] && (f.getMonth() + 1) === +d[1]; }
  
  get ingresosDelMes(): number { return this.movimientosActuales.filter(m => m.tipo === 'Abono' && this.esMesDashboard(m.fecha) && !this.esAnulado(m)).reduce((t, m) => t + m.valorTotalUsd, 0); }
  get ingresosDelMesBs(): number { return this.movimientosActuales.filter(m => m.tipo === 'Abono' && this.esMesDashboard(m.fecha) && !this.esAnulado(m)).reduce((t, m) => t + (m.valorTotalBs || 0), 0); }
  get gastosDelMes(): number { return this.movimientosActuales.filter(m => m.tipo === 'Entrada' && this.esMesDashboard(m.fecha) && !this.esAnulado(m)).reduce((t, m) => t + m.valorTotalUsd, 0); }
  get gastosDelMesBs(): number { return this.movimientosActuales.filter(m => m.tipo === 'Entrada' && this.esMesDashboard(m.fecha) && !this.esAnulado(m)).reduce((t, m) => t + (m.valorTotalBs || 0), 0); }
  
  get gananciaDelMes(): number { 
    let gananciaTotal = 0;
    const abonosMes = this.movimientosActuales.filter(m => m.tipo === 'Abono' && this.esMesDashboard(m.fecha) && !this.esAnulado(m));
    abonosMes.forEach(abono => {
      const salidasFactura = this.movimientosActuales.filter(m => m.facturaId === abono.facturaId && m.tipo === 'Salida');
      const ventaTotalUsd = salidasFactura.reduce((t, m) => t + m.valorTotalUsd, 0);
      const gananciaTotalUsd = salidasFactura.reduce((t, m) => t + (m.gananciaUsd || 0), 0);
      const margen = ventaTotalUsd > 0 ? (gananciaTotalUsd / ventaTotalUsd) : 0;
      gananciaTotal += (abono.valorTotalUsd * margen);
    });
    return gananciaTotal;
  }

  get gananciaDelMesBs(): number { 
    let gananciaTotalBs = 0;
    const abonosMes = this.movimientosActuales.filter(m => m.tipo === 'Abono' && this.esMesDashboard(m.fecha) && !this.esAnulado(m));
    abonosMes.forEach(abono => {
      const salidasFactura = this.movimientosActuales.filter(m => m.facturaId === abono.facturaId && m.tipo === 'Salida');
      const ventaTotalUsd = salidasFactura.reduce((t, m) => t + m.valorTotalUsd, 0);
      const costoTotalBs = salidasFactura.reduce((t, m) => t + ((m.valorTotalBs || 0) - (m.gananciaBs || 0)), 0);
      const porcentajeAbonado = ventaTotalUsd > 0 ? (abono.valorTotalUsd / ventaTotalUsd) : 0;
      const costoAsignadoBs = costoTotalBs * porcentajeAbonado;
      gananciaTotalBs += (abono.valorTotalBs - costoAsignadoBs);
    });
    return gananciaTotalBs;
  }

  get cantidadVentasMes(): number {
    const ventas = this.movimientosActuales.filter(m => m.tipo === 'Salida' && !!m.facturaId && this.esMesDashboard(m.fecha) && !this.esAnulado(m));
    return new Set(ventas.map(v => v.facturaId)).size;
  }
}
