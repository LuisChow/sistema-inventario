import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { InventoryService, Repuesto, ItemCarrito, Movimiento, ClienteInfoVenta } from '../../../core/inventory';
import { CartService } from '../../../core/cart.service';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmationService } from '../../../core/confirmation.service';
import * as XLSX from 'xlsx-js-style';

/** Estado del modal de confirmación de venta (antes de procesar). */
interface VentaConfirmacionState {
  nom: string;
  doc: string;
  tel: string;
  dir: string;
  totalUsd: number;
  /** Total en Bs ya formateado como string con 2 decimales. */
  totalBs: string;
  metodo: 'Contado' | 'Credito';
  pagoInicial: number;
}

/** Estado del modal "¿usar promedio ponderado?" al editar el costo + stock. */
interface ConfirmacionPromedioState {
  costoAnteriorUsd: number;
  costoIngresadoUsd: number;
  promedioCalculadoUsd: number;
  promedioCalculadoBs: number;
  valorTransaccionUsd: number;
  valorTransaccionBs: number;
  cantNueva: number;
  stockAnterior: number;
  productoPendiente: Repuesto;
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './product-list.html',
  styleUrl: './product-list.css'
})
export class ProductList implements OnInit {
  public inventoryService = inject(InventoryService);
  public cartService = inject(CartService);
  private cdr = inject(ChangeDetectorRef);
  private notifications = inject(NotificationService);
  private confirmation = inject(ConfirmationService);
  
  carrito: ItemCarrito[] = []; 
  repuestos: Repuesto[] = [];
  movimientosGlobales: Movimiento[] = []; 

  datosCliente = { nombre: '', documento: '', telefono: '', direccion: '' };
  textoBusqueda: string = ''; 
  categoriaSeleccionada: string = localStorage.getItem('filtroCategoria') || 'Todas';
  paginaActual: number = 1; itemsPorPagina: number = 10;
  columnaOrden: string = ''; ordenAscendente: boolean = true;
  productoAVender: Repuesto | null = null; cantidadVender: number = 1;
  productoAEditar: Repuesto | null = null; edicion = { cantidad: 0, costo: 0, venta: 0, descripcion: '' };
  ventaConfirmacion: VentaConfirmacionState | null = null;
  confirmacionPromedio: ConfirmacionPromedioState | null = null;

  productoHistorial: Repuesto | null = null;
  movimientosProducto: Movimiento[] = [];
  
  calendarioMes: number = new Date().getMonth();
  calendarioAnio: number = new Date().getFullYear();

  ngOnInit() {
    this.inventoryService.inventario$.subscribe(datos => { this.repuestos = datos; this.cdr.detectChanges(); });
    this.cartService.carrito$.subscribe(c => { this.carrito = c; this.cdr.detectChanges(); });
    
    this.inventoryService.movimientos$.subscribe(m => { 
      this.movimientosGlobales = m; 
      if (this.productoHistorial) this.abrirHistorialProducto(this.productoHistorial); 
    });
  }

  guardarFiltroCategoria() {
    localStorage.setItem('filtroCategoria', this.categoriaSeleccionada);
    this.paginaActual = 1;
    this.cdr.detectChanges();
  }

  get totalPaginas(): number { return Math.ceil(this.listaFiltrada.length / this.itemsPorPagina) || 1; }
  get listaPaginada(): Repuesto[] { const inicio = (this.paginaActual - 1) * this.itemsPorPagina; return this.listaFiltrada.slice(inicio, inicio + this.itemsPorPagina); }
  cambiarPagina(direccion: number) { const n = this.paginaActual + direccion; if (n >= 1 && n <= this.totalPaginas) { this.paginaActual = n; this.cdr.detectChanges(); } }

  get listaFiltrada(): Repuesto[] {
    let lista = this.repuestos;
    if (this.categoriaSeleccionada !== 'Todas') lista = lista.filter(item => item.categoria === this.categoriaSeleccionada);
    if (this.textoBusqueda.trim() !== '') {
      const termino = this.textoBusqueda.toLowerCase();
      lista = lista.filter(item => item.nombre.toLowerCase().includes(termino) || item.codigo.toLowerCase().includes(termino));
    }
    if (this.columnaOrden !== '') {
      lista = [...lista].sort((a, b) => {
        let vA: string | number = a[this.columnaOrden as keyof Repuesto] ?? '';
        let vB: string | number = b[this.columnaOrden as keyof Repuesto] ?? '';
        if (typeof vA === 'string' && typeof vB === 'string') { vA = vA.toLowerCase(); vB = vB.toLowerCase(); }
        if (vA < vB) return this.ordenAscendente ? -1 : 1;
        if (vA > vB) return this.ordenAscendente ? 1 : -1; return 0;
      });
    }
    return lista;
  }

  ordenarPor(columna: string) { if (this.columnaOrden === columna) { this.ordenAscendente = !this.ordenAscendente; } else { this.columnaOrden = columna; this.ordenAscendente = true; } this.cdr.detectChanges(); }
  async borrarProducto(item: Repuesto) {
    const ok = await this.confirmation.ask(
      `¿Eliminar "${item.nombre}"? Esta acción no se puede deshacer.\n\nSi el producto no tiene ventas, también se borrará su registro inicial y los ajustes asociados.`,
      { title: 'Eliminar producto', confirmText: 'Eliminar', danger: true }
    );
    if (!ok) return;

    // El toast de éxito solo dispara cuando el backend confirma. Si el producto
    // tiene ventas, el backend devuelve 409 y el interceptor ya muestra el error;
    // este next callback no se ejecuta.
    this.inventoryService.eliminarRepuesto(item.codigo).subscribe({
      next: () => this.notifications.success(`Producto "${item.nombre}" eliminado.`)
    });
  }
  calcularBs(precioDolares: number): string { return (precioDolares * this.inventoryService.tasaCambio).toFixed(2); }

  abrirHistorialProducto(item: Repuesto) {
    this.productoHistorial = item;
    this.calendarioMes = new Date().getMonth();
    this.calendarioAnio = new Date().getFullYear();
    
    this.movimientosProducto = this.movimientosGlobales
      .filter(m => m.codigoProducto === item.codigo && m.tipo !== 'Abono' && !this.inventoryService.esAnulado(m)) 
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()); 
    this.cdr.detectChanges();
  }

  cerrarHistorialProducto() { this.productoHistorial = null; this.movimientosProducto = []; this.cdr.detectChanges(); }

  nombreMes(mes: number): string {
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return meses[mes];
  }

  cambiarMesCalendario(delta: number) {
    this.calendarioMes += delta;
    if (this.calendarioMes > 11) { this.calendarioMes = 0; this.calendarioAnio++; } 
    else if (this.calendarioMes < 0) { this.calendarioMes = 11; this.calendarioAnio--; }
    this.cdr.detectChanges();
  }

  get diasCalendario() {
    if (!this.productoHistorial) return [];
    const dias = [];
    const primerDia = new Date(this.calendarioAnio, this.calendarioMes, 1).getDay(); 
    const ultimoDia = new Date(this.calendarioAnio, this.calendarioMes + 1, 0).getDate();

    for (let i = 0; i < primerDia; i++) dias.push({ dia: 0, cantVendida: 0 });

    for (let i = 1; i <= ultimoDia; i++) {
      const ventasDelDia = this.movimientosProducto.filter(m => 
        m.tipo === 'Salida' && !!m.facturaId &&
        new Date(m.fecha).getDate() === i &&
        new Date(m.fecha).getMonth() === this.calendarioMes &&
        new Date(m.fecha).getFullYear() === this.calendarioAnio
      );
      const cantVendida = ventasDelDia.reduce((sum, m) => sum + m.cantidad, 0);
      dias.push({ dia: i, cantVendida });
    }
    return dias;
  }

  get estadisticasMesProducto() {
    let cantidad = 0; let costoUsd = 0; let ventaUsd = 0; let gananciaUsd = 0; let gananciaBs = 0;
    if (!this.productoHistorial) return { cantidad, costoUsd, ventaUsd, gananciaUsd, gananciaBs };

    const ventasMes = this.movimientosProducto.filter(m => 
      m.tipo === 'Salida' && !!m.facturaId &&
      new Date(m.fecha).getMonth() === this.calendarioMes &&
      new Date(m.fecha).getFullYear() === this.calendarioAnio
    );

    ventasMes.forEach(m => {
      cantidad += m.cantidad;
      ventaUsd += m.valorTotalUsd;
      gananciaUsd += (m.gananciaUsd || 0);
      gananciaBs += (m.gananciaBs || 0);
    });
    costoUsd = ventaUsd - gananciaUsd;

    return { cantidad, costoUsd, ventaUsd, gananciaUsd, gananciaBs };
  }

  abrirModalEditar(item: Repuesto) { this.productoAEditar = { ...item }; this.edicion.descripcion = ''; this.cdr.detectChanges(); }
  cerrarModalEditar() { this.productoAEditar = null; this.cdr.detectChanges(); }

  // 🚨 SISTEMA DE GUARDADO BLINDADO 
  guardarEdicion() {
    if (!this.productoAEditar) return;

    let cantNueva = Number(this.productoAEditar.cantidad);
    let costoIngresadoUsd = Number(this.productoAEditar.precioCompra); 
    
    if (cantNueva < 0) {
      this.notifications.warning('El stock no puede ser negativo.');
      return;
    }
    if (costoIngresadoUsd < 0 || Number(this.productoAEditar.precioVenta) < 0) {
      this.notifications.warning('Los precios no pueden ser negativos.');
      return;
    }

    const itemOriginal = this.inventoryService.inventarioActual.find(p => p.codigo === this.productoAEditar!.codigo);
    const stockAnterior = itemOriginal ? Number(itemOriginal.cantidad) : 0;
    const costoAnteriorUsd = itemOriginal ? Number(itemOriginal.precioCompra) : 0;
    const costoAnteriorBs = itemOriginal ? Number(itemOriginal.precioCompraBs || 0) : 0; 

    const diff = cantNueva - stockAnterior;

    if (diff < 0 && Math.abs(costoIngresadoUsd - costoAnteriorUsd) > 0.01) {
      this.notifications.error(
        'Por seguridad contable, no puedes cambiar el costo unitario al mismo tiempo que reduces el stock.\n\nEl costo se restauró a su valor histórico. Si necesitas cambiar el costo, hazlo sumando stock o sin modificar la cantidad.',
        'Seguridad contable',
        8000
      );
      this.productoAEditar.precioCompra = costoAnteriorUsd;
      return;
    }

    if (diff > 0 && stockAnterior > 0 && Math.abs(costoIngresadoUsd - costoAnteriorUsd) > 0.01) {
      const valorTransaccionUsd = diff * costoIngresadoUsd;
      const valorTransaccionBs = valorTransaccionUsd * this.inventoryService.tasaCambio; 
      const valorViejoUsd = stockAnterior * costoAnteriorUsd;
      const valorViejoBs = stockAnterior * costoAnteriorBs;

      const promedioCalculadoUsd = (valorViejoUsd + valorTransaccionUsd) / cantNueva;
      const promedioCalculadoBs = (valorViejoBs + valorTransaccionBs) / cantNueva;

      // Guardamos la edición temporal aquí dentro para no perderla
      this.confirmacionPromedio = {
        costoAnteriorUsd, costoIngresadoUsd, promedioCalculadoUsd, promedioCalculadoBs,
        valorTransaccionUsd, valorTransaccionBs, cantNueva, stockAnterior,
        productoPendiente: { ...this.productoAEditar } 
      };
      
      this.cerrarModalEditar(); // Cerramos el de edición INMEDIATAMENTE
      return; 
    }

    let valorTransUsd = 0; let valorTransBs = 0;
    let costoFinalUsd = costoIngresadoUsd;
    let costoFinalBs = costoIngresadoUsd * this.inventoryService.tasaCambio;

    if (diff > 0) {
      valorTransUsd = diff * costoIngresadoUsd;
      valorTransBs = valorTransUsd * this.inventoryService.tasaCambio;
      if (stockAnterior > 0) {
        const valorViejoBs = stockAnterior * costoAnteriorBs;
        costoFinalBs = (valorViejoBs + valorTransBs) / cantNueva;
      }
    } else if (diff < 0) {
      valorTransUsd = Math.abs(diff) * costoAnteriorUsd;
      valorTransBs = Math.abs(diff) * costoAnteriorBs; 
      costoFinalUsd = costoAnteriorUsd; 
      costoFinalBs = costoAnteriorBs; 
    } else {
      if (Math.abs(costoIngresadoUsd - costoAnteriorUsd) < 0.01) costoFinalBs = costoAnteriorBs;
    }

    this.ejecutarGuardadoFinal(costoFinalUsd, costoFinalBs, valorTransUsd, valorTransBs, { ...this.productoAEditar });
  }

  resolverConfirmacionCosto(promediar: boolean) {
    if (!this.confirmacionPromedio) return;
    const costoFinalUsd = promediar ? this.confirmacionPromedio.promedioCalculadoUsd : this.confirmacionPromedio.costoIngresadoUsd;
    const costoFinalBs = promediar ? this.confirmacionPromedio.promedioCalculadoBs : (this.confirmacionPromedio.costoIngresadoUsd * this.inventoryService.tasaCambio);
    const valorTransUsd = this.confirmacionPromedio.valorTransaccionUsd;
    const valorTransBs = this.confirmacionPromedio.valorTransaccionBs;
    const productoPendiente = this.confirmacionPromedio.productoPendiente;
    
    this.ejecutarGuardadoFinal(costoFinalUsd, costoFinalBs, valorTransUsd, valorTransBs, productoPendiente);
    this.confirmacionPromedio = null;
    this.cdr.detectChanges();
  }

  cancelarPromedio() {
    // Si cancela, reabrimos el modal de edición original para que no pierda su trabajo
    if (this.confirmacionPromedio) {
      this.productoAEditar = { ...this.confirmacionPromedio.productoPendiente };
    }
    this.confirmacionPromedio = null;
    this.cdr.detectChanges();
  }

  ejecutarGuardadoFinal(costoFinalUnitarioUsd: number, costoFinalUnitarioBs: number, valorTransaccionUsd: number, valorTransaccionBs: number, productoEditado: Repuesto) {
    const itemOriginal = this.inventoryService.inventarioActual.find(p => p.codigo === productoEditado.codigo);
    if (!itemOriginal) return;

    const productoActualizado = {
      ...productoEditado,
      nombre: productoEditado.nombre.trim(),
      cantidad: Number(productoEditado.cantidad),
      precioCompra: costoFinalUnitarioUsd, 
      precioVenta: Number(productoEditado.precioVenta),
      precioCompraBs: costoFinalUnitarioBs
    };

    const index = this.repuestos.findIndex(p => p.codigo === productoActualizado.codigo);
    if (index !== -1) { this.repuestos[index] = productoActualizado; this.repuestos = [...this.repuestos]; }
    
    this.inventoryService.editarRepuesto(productoActualizado, itemOriginal, this.edicion.descripcion, valorTransaccionUsd, valorTransaccionBs);
    this.cerrarModalEditar();
  }

  abrirModalVender(item: Repuesto) {
    if (item.cantidad <= 0) {
      this.notifications.warning('No hay stock disponible.');
      return;
    }
    this.productoAVender = item;
    this.cantidadVender = 1;
    this.cdr.detectChanges();
  }
  cerrarModalVender() { this.productoAVender = null; this.cdr.detectChanges(); }
  confirmarVentaModal() {
    if (this.cantidadVender <= 0 || this.cantidadVender > this.productoAVender!.cantidad) {
      this.notifications.warning('Cantidad inválida.');
      return;
    }
    this.cartService.agregarAlCarrito(this.productoAVender!, this.cantidadVender);
    this.productoAVender = null;
    this.cdr.detectChanges();
  }
  
  quitarDelCarrito(codigo: string) { this.cartService.quitarDelCarrito(codigo); }
  async vaciarCarrito() {
    const ok = await this.confirmation.ask('¿Vaciar el carrito?', { title: 'Vaciar carrito', confirmText: 'Vaciar', danger: true });
    if (ok) this.cartService.vaciarCarrito();
  }

  procesarVentaCompleta() {
    if (this.carrito.length === 0) return;
    const nom = this.datosCliente.nombre.trim(); const doc = this.datosCliente.documento.trim(); const tel = this.datosCliente.telefono.trim(); const dir = this.datosCliente.direccion.trim();
    if (!nom) {
      this.notifications.warning('El Nombre / Razón Social es obligatorio.');
      return;
    }
    if (nom.length > 200) {
      this.notifications.warning('El Nombre es muy largo (máximo 200 caracteres).');
      return;
    }
    // Teléfono: aceptamos dígitos, +, -, espacios y paréntesis para códigos de área.
    if (tel && !/^[0-9+\-\s()]+$/.test(tel)) {
      this.notifications.warning('El Teléfono solo puede contener dígitos, espacios, +, - y paréntesis.');
      return;
    }
    
    this.ventaConfirmacion = {
      nom, doc, tel, dir,
      totalUsd: this.cartService.totalCarrito,
      totalBs: this.calcularBs(this.cartService.totalCarrito),
      metodo: 'Contado',
      pagoInicial: 0
    };
    this.cdr.detectChanges(); 
  }

  cerrarModalFactura() { this.ventaConfirmacion = null; this.cdr.detectChanges(); }

  ejecutarVenta() {
    if (!this.ventaConfirmacion) return;
    const vc = this.ventaConfirmacion;
    const pago = vc.metodo === 'Credito' ? Number(vc.pagoInicial) : vc.totalUsd;
    if (vc.metodo === 'Credito') {
      if (isNaN(pago) || pago < 0) {
        this.notifications.warning('El abono no puede ser menor a $0.');
        return;
      }
      if (pago > vc.totalUsd) {
        this.notifications.error(`No puedes registrar un abono ($${pago}) mayor al total de la factura ($${vc.totalUsd}).`);
        return;
      }
    }

    const info: ClienteInfoVenta = {
      nombre: vc.nom,
      documento: vc.doc,
      telefono: vc.tel,
      direccion: vc.dir,
      metodoPago: vc.metodo,
      pagoInicial: pago
    };

    this.inventoryService.procesarVentaCarrito(info).subscribe({
      next: () => {
        // Solo limpiamos y notificamos si la venta SE COMPLETÓ (transacción exitosa).
        // Si falla (stock insuficiente, red caída...), el interceptor muestra el error
        // y dejamos el modal abierto para que el usuario reintente.
        this.ventaConfirmacion = null;
        this.datosCliente = { nombre: '', documento: '', telefono: '', direccion: '' };
        this.notifications.success('Factura procesada con éxito.');
        this.cdr.detectChanges();
      }
    });
  }

  exportarExcel() {
    const datos = this.repuestos.map(i => ({ 
      'Código': i.codigo, 
      'Descripción': i.nombre, 
      'Categoría': i.categoria, 
      'Stock': Math.abs(i.cantidad), 
      'Compra ($)': Math.abs(i.precioCompra), 
      'Venta ($)': Math.abs(i.precioVenta),
      'Compra (Bs)': Math.abs(i.precioCompraBs || 0),
      'Venta (Bs)': Math.abs(i.precioVenta * this.inventoryService.tasaCambio)
    }));

    const hoja = XLSX.utils.json_to_sheet(datos);

    hoja['!cols'] = [
      { wch: 11 }, { wch: 43 }, { wch: 16 }, { wch: 9 }, 
      { wch: 11 }, { wch: 16 }, { wch: 12 }, { wch: 12 }
    ];

    const rango = XLSX.utils.decode_range(hoja['!ref'] || 'A1:H1');
    for (let r = rango.s.r; r <= rango.e.r; r++) {
      for (let c = rango.s.c; c <= rango.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r: r, c: c });
        if (!hoja[cellAddress]) continue;

        const bordeFino = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } }
        };

        if (r === 0) { 
          hoja[cellAddress].s = {
            fill: { fgColor: { rgb: "000000" } },
            font: { color: { rgb: "FFFFFF" }, bold: true },
            alignment: { horizontal: "center", vertical: "center" },
            border: bordeFino
          };
        } else { 
          hoja[cellAddress].s = { border: bordeFino };
        }
      }
    }

    const libro = XLSX.utils.book_new(); 
    XLSX.utils.book_append_sheet(libro, hoja, 'Inventario');
    XLSX.writeFile(libro, 'Inventario_General.xlsx');
  }

  exportarProductoExcel(item: Repuesto) {
    const movimientosProd = this.movimientosGlobales
      .filter(m => m.codigoProducto === item.codigo && m.tipo !== 'Abono' && !this.inventoryService.esAnulado(m))
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    if (movimientosProd.length === 0) {
      this.notifications.warning('No hay movimientos registrados para este producto.');
      return;
    }

    const datos = movimientosProd.map(m => {
      const esEntrada = m.tipo === 'Entrada';
      const esSalida = m.tipo === 'Salida';

      return {
        'Código': m.codigoProducto,
        'Descripción': m.descripcion || m.nombreProducto,
        'Entrada': esEntrada ? Math.abs(m.cantidad) : 0,
        'Salida': esSalida ? Math.abs(m.cantidad) : 0,
        'Compra $': esEntrada ? Math.abs(m.valorTotalUsd) : 0, 
        'Venta $': esSalida ? Math.abs(m.valorTotalUsd) : 0,     
        'Ganancia $': esSalida ? Math.abs(m.gananciaUsd || 0) : 0,
        'Compra Bs': esEntrada ? Math.abs(m.valorTotalBs || 0) : 0,
        'Venta Bs': esSalida ? Math.abs(m.valorTotalBs || 0) : 0,
        'Ganancia Bs': esSalida ? Math.abs(m.gananciaBs || 0) : 0,
        'Fecha': new Date(m.fecha).toLocaleString()
      };
    });

    const hoja = XLSX.utils.json_to_sheet(datos);

    hoja['!cols'] = [
      { wch: 19 }, { wch: 25 }, { wch: 18 }, { wch: 17 }, { wch: 17 }, 
      { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 15 }, { wch: 16 }, { wch: 22 }
    ];

    const rango = XLSX.utils.decode_range(hoja['!ref'] || 'A1:K1');
    for (let r = rango.s.r; r <= rango.e.r; r++) {
      for (let c = rango.s.c; c <= rango.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r: r, c: c });
        if (!hoja[cellAddress]) continue;

        const bordeFino = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } }
        };

        if (r === 0) {
          hoja[cellAddress].s = {
            fill: { fgColor: { rgb: "000000" } },
            font: { color: { rgb: "FFFFFF" }, bold: true },
            alignment: { horizontal: "center", vertical: "center" },
            border: bordeFino
          };
        } else {
          hoja[cellAddress].s = { border: bordeFino };
        }
      }
    }

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Movimientos');
    XLSX.writeFile(libro, `Historial_${item.codigo}.xlsx`);
  }

  importarExcel(event: Event) {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = (e: ProgressEvent<FileReader>) => {
      const buffer = e.target?.result;
      if (!(buffer instanceof ArrayBuffer)) return;
      const libro = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const datosJson: Record<string, unknown>[] = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]]);
      const codigosDuplicados: string[] = []; let productosImportados = 0;

      datosJson.forEach(fila => {
        const codigoRaw = fila['Codigo'] || fila['Código']; 
        const descRaw = fila['Descripcion'] || fila['Descripción']; 
        
        if (codigoRaw && descRaw) {
          const codigoStr = codigoRaw.toString().trim();
          const descStr = descRaw.toString().trim();
          const existe = this.repuestos.some(r => r.codigo.toLowerCase() === codigoStr.toLowerCase());

          if (existe) { codigosDuplicados.push(codigoStr); } else {
            const precioC = Number(fila['Compra ($)']) || Number(fila['Costo ($)']) || 0;
            const precioV = Number(fila['Venta ($)']) || Number(fila[' Venta ($)']) || Number(fila['Precio Venta ($)']) || 0;
            
            // Las celdas de Excel vienen como `unknown` (pueden ser string, number, fecha...).
            // String() las convierte de forma segura para que encaje en `categoria: string`.
            const categoriaRaw = fila['Categoria'] || fila['Categoría'] || this.inventoryService.categorias[0] || 'General';
            const r: Repuesto = {
              codigo: codigoStr, nombre: descStr,
              categoria: String(categoriaRaw),
              // SQLite trunca enteros: redondeamos en el frontend para que el usuario
              // sepa qué número quedó guardado en vez de descubrirlo después.
              cantidad: Math.round(Number(fila['Stock'])) || 0, precioCompra: precioC, precioVenta: precioV,
              precioCompraBs: precioC * this.inventoryService.tasaCambio
            };
            this.inventoryService.agregarRepuesto(r); this.inventoryService.agregarCategoria(r.categoria); productosImportados++;
          }
        }
      });

      if (codigosDuplicados.length > 0) {
        this.notifications.warning(
          `Productos añadidos: ${productosImportados}\nOmitidos (ya existen): ${codigosDuplicados.length}\n\nCódigos duplicados:\n${codigosDuplicados.join(', ')}`,
          'Importación parcial',
          10000
        );
      } else {
        this.notifications.success(`Se importaron ${productosImportados} productos sin errores.`);
      }
      input.value = '';
    }; lector.readAsArrayBuffer(archivo);
  }
}
