import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService, Movimiento, Repuesto } from '../../../core/inventory';
import { NotificationService } from '../../../core/notification.service';
import { InvoicePrintService, FacturaImprimible } from '../../../core/invoice-print.service';
import { ConfigService } from '../../../core/config.service';
import * as XLSX from 'xlsx-js-style';

export interface GrupoFactura {
  id: string; fecha: Date; descripcion: string; tipoOperacion: string;
  totalUsd: number; gananciaUsd: number; totalBs: number; gananciaBs: number;
  totalPagado: number; totalPagadoBs: number; 
  gananciaRealizadaUsd: number; gananciaRealizadaBs: number; 
  detalles: Movimiento[]; estado: string; 
  clienteNombre: string; clienteDocumento: string; clienteTelefono: string; clienteDireccion: string;
}

@Component({
  selector: 'app-stock-moves',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stock-moves.html',
  styleUrl: './stock-moves.css'
})
export class StockMoves implements OnInit {
  public inventoryService = inject(InventoryService);
  private cdr = inject(ChangeDetectorRef);
  private notifications = inject(NotificationService);
  private invoicePrint = inject(InvoicePrintService);
  private configService = inject(ConfigService);

  movimientos: Movimiento[] = []; 
  expandidos: { [key: string]: boolean } = {}; 

  paginaActual: number = 1; itemsPorPagina: number = 10; 
  textoBusqueda: string = ''; 
  tipoSeleccionado: string = localStorage.getItem('filtroHistorial') || 'Todos'; 
  mesAnoSeleccionado: string = ''; 

  facturaAPagar: GrupoFactura | null = null;
  montoAbono: number = 0;
  facturaARevertir: GrupoFactura | null = null;

  ngOnInit() {
    this.inventoryService.movimientos$.subscribe(datos => { this.movimientos = datos; this.cdr.detectChanges(); });
    // Cargamos la configuración de la empresa para que el servicio de impresión
    // tenga los datos listos cuando el usuario haga clic en "Imprimir".
    this.configService.cargar().subscribe();
  }

  /**
   * Construye una FacturaImprimible a partir del grupo y abre la ventana de
   * impresión. Sólo aplica a operaciones de tipo "Venta".
   */
  imprimirFactura(grupo: GrupoFactura, event: Event): void {
    event.stopPropagation();
    if (grupo.tipoOperacion !== 'Venta') {
      this.notifications.warning('Sólo se pueden imprimir facturas de venta.');
      return;
    }

    // Detectamos método de pago desde el primer detalle que lo tenga.
    const conMetodo = grupo.detalles.find(d => d.metodoPago);
    const metodoPago = conMetodo?.metodoPago || 'Contado';

    // Sólo las salidas son líneas de la factura (los abonos son pagos, no items).
    const items = grupo.detalles
      .filter(d => d.tipo === 'Salida')
      .map(d => ({
        codigo: d.codigoProducto,
        descripcion: d.nombreProducto,
        cantidad: d.cantidad,
        precioUnitario: d.cantidad > 0 ? d.valorTotalUsd / d.cantidad : 0,
        total: d.valorTotalUsd
      }));

    const factura: FacturaImprimible = {
      id: grupo.id,
      fecha: grupo.fecha,
      cliente: {
        nombre: grupo.clienteNombre,
        documento: grupo.clienteDocumento !== 'N/A' ? grupo.clienteDocumento : undefined,
        telefono: grupo.clienteTelefono !== 'N/A' ? grupo.clienteTelefono : undefined,
        direccion: grupo.clienteDireccion !== 'No especificada' ? grupo.clienteDireccion : undefined
      },
      items,
      totalUsd: grupo.totalUsd,
      totalBs: grupo.totalBs,
      pagado: grupo.totalPagado,
      pagadoBs: grupo.totalPagadoBs,
      metodoPago,
      estado: grupo.estado
    };

    this.invoicePrint.imprimirFactura(factura);
  }

  guardarFiltroHistorial() {
    localStorage.setItem('filtroHistorial', this.tipoSeleccionado);
    this.paginaActual = 1;
    this.cdr.detectChanges();
  }

  toggleExpandir(id: string) { this.expandidos[id] = !this.expandidos[id]; }

  obtenerTipoOperacion(mov: Movimiento): string {
    if (mov.tipo === 'Modificacion') return 'Modificación';
    const desc = (mov.descripcion || '').toLowerCase();
    if (mov.tipo === 'Salida') return desc.includes('venta') ? 'Venta' : 'Avería';
    if (mov.tipo === 'Entrada') return desc.includes('registro inicial') ? 'Entrada Inicial' : 'Entrada';
    return 'Ajuste';
  }

  abrirModalPago(factura: GrupoFactura, event: Event) { event.stopPropagation(); this.facturaAPagar = factura; this.montoAbono = factura.totalUsd - factura.totalPagado; this.cdr.detectChanges(); }
  cerrarModalPago() { this.facturaAPagar = null; this.cdr.detectChanges(); }

  confirmarPago() {
    if (!this.facturaAPagar) return;
    const deuda = this.facturaAPagar.totalUsd - this.facturaAPagar.totalPagado;
    const monto = Number(this.montoAbono);

    if (isNaN(monto) || monto <= 0) {
      this.notifications.warning('Monto inválido. Debe ser mayor a $0.');
      return;
    }
    if (monto > deuda + 0.01) {
      this.notifications.error(`El abono ($${monto}) supera la deuda restante ($${deuda.toFixed(2)}).`);
      return;
    }

    this.inventoryService.registrarMovimiento({
      fecha: new Date(), codigoProducto: 'PAGO', nombreProducto: 'Abono a Factura',
      tipo: 'Abono', cantidad: 1, descripcion: 'Abono/Pago posterior',
      valorTotalUsd: monto, gananciaUsd: 0,
      valorTotalBs: monto * this.inventoryService.tasaCambio, gananciaBs: 0,
      facturaId: this.facturaAPagar.id, clienteNombre: this.facturaAPagar.clienteNombre, clienteDocumento: this.facturaAPagar.clienteDocumento, 
      clienteTelefono: this.facturaAPagar.clienteTelefono, clienteDireccion: this.facturaAPagar.clienteDireccion,
      metodoPago: 'Credito', estadoPago: 'Abono'
    });
    this.notifications.success('Pago registrado con éxito.');
    this.cerrarModalPago();
  }

  abrirModalRevertir(factura: GrupoFactura, event: Event) { event.stopPropagation(); this.facturaARevertir = factura; this.cdr.detectChanges(); }
  cerrarModalRevertir() { this.facturaARevertir = null; this.cdr.detectChanges(); }

  confirmarReversion() {
    if (!this.facturaARevertir) return;

    this.facturaARevertir.detalles.forEach((item: Movimiento) => {
      // Abonos y anulaciones no representan cambios al producto: el pago no se
      // "deshace" tocando el producto, y el sello de anulacion es informativo.
      if (item.tipo === 'Abono' || item.tipo === 'Anulacion') return;

      const repuesto = this.inventoryService.inventarioActual.find(r => r.codigo === item.codigoProducto);
      if (!repuesto) return;

      // 1) Estado base: copiamos el producto actual y vamos aplicando reversiones
      let nuevaCantidad = repuesto.cantidad;
      let nuevoCostoUsd = repuesto.precioCompra;
      let nuevoCostoBs = repuesto.precioCompraBs || 0;
      let nuevoPrecioVenta = repuesto.precioVenta;
      let nuevaCategoria = repuesto.categoria;
      let nuevoNombre = repuesto.nombre;

      const valorActualUsd = repuesto.cantidad * repuesto.precioCompra;
      const valorActualBs = repuesto.cantidad * (repuesto.precioCompraBs || 0);

      // 2) Si el movimiento mueve stock, revertimos cantidad y costo promedio
      if (item.tipo === 'Salida') {
        nuevaCantidad += item.cantidad;
        const costoExtraidoUsd = item.valorTotalUsd - (item.gananciaUsd || 0);
        const costoExtraidoBs = (item.valorTotalBs || 0) - (item.gananciaBs || 0);
        nuevoCostoUsd = nuevaCantidad > 0 ? (valorActualUsd + costoExtraidoUsd) / nuevaCantidad : repuesto.precioCompra;
        nuevoCostoBs = nuevaCantidad > 0 ? (valorActualBs + costoExtraidoBs) / nuevaCantidad : (repuesto.precioCompraBs || 0);
      } else if (item.tipo === 'Entrada') {
        nuevaCantidad -= item.cantidad;
        nuevoCostoUsd = nuevaCantidad > 0 ? Math.max(0, (valorActualUsd - item.valorTotalUsd) / nuevaCantidad) : repuesto.precioCompra;
        nuevoCostoBs = nuevaCantidad > 0 ? Math.max(0, (valorActualBs - (item.valorTotalBs || 0)) / nuevaCantidad) : (repuesto.precioCompraBs || 0);
      }
      // Para 'Modificacion' la cantidad no se toca

      // 3) Aplicamos cambios de campos desde el JSON `metadatos` si lo hay.
      // Esto cubre el caso de la queja: anular un cambio de costo/precio/categoria/nombre.
      // Tambien funciona para ajustes (Entrada/Salida) que ademas cambiaron campos.
      const camposViejos = this.parseMetadatosOld(item);
      if (camposViejos) {
        if (camposViejos.precioCompra !== undefined) nuevoCostoUsd = camposViejos.precioCompra;
        if (camposViejos.precioCompraBs !== undefined) nuevoCostoBs = camposViejos.precioCompraBs;
        if (camposViejos.precioVenta !== undefined) nuevoPrecioVenta = camposViejos.precioVenta;
        if (camposViejos.categoria !== undefined) nuevaCategoria = camposViejos.categoria;
        if (camposViejos.nombre !== undefined) nuevoNombre = camposViejos.nombre;
      }

      this.inventoryService.actualizarRepuestoSilencioso({
        ...repuesto,
        cantidad: nuevaCantidad,
        precioCompra: nuevoCostoUsd,
        precioCompraBs: nuevoCostoBs,
        precioVenta: nuevoPrecioVenta,
        categoria: nuevaCategoria,
        nombre: nuevoNombre
      });
    });

    this.inventoryService.registrarMovimiento({
      fecha: new Date(), codigoProducto: 'ANUL', nombreProducto: 'SELLO DE ANULACIÓN',
      tipo: 'Anulacion', cantidad: 0, descripcion: 'Operación Anulada',
      valorTotalUsd: 0, gananciaUsd: 0, valorTotalBs: 0, gananciaBs: 0,
      facturaId: this.facturaARevertir.id
    });
    this.notifications.success('Operación revertida con éxito.');
    this.cerrarModalRevertir();
  }

  /**
   * Saca los valores antiguos de un movimiento para revertir campos.
   * Prioriza `metadatos` (JSON con { old, new }) que es lo que registramos a
   * partir de ahora. Como fallback, intenta parsear la `descripcion`
   * (formato "Costo: $X ➝ $Y | Venta: ...") para movimientos viejos creados
   * antes de esta mejora — funciona solo con campos numéricos.
   */
  private parseMetadatosOld(item: Movimiento): Partial<Repuesto> | null {
    // Prefer metadatos JSON (nuevo, exacto, incluye nombre y categoria)
    if (item.metadatos) {
      try {
        const m = JSON.parse(item.metadatos);
        if (m && m.old && typeof m.old === 'object') return m.old as Partial<Repuesto>;
      } catch {
        // ignoramos JSON inválido y caemos al parsing de descripción
      }
    }
    // Fallback: parsear descripción de Modificaciones viejas
    if (item.tipo !== 'Modificacion' || !item.descripcion) return null;
    const desc = item.descripcion;
    const old: Partial<Repuesto> = {};
    const costo = desc.match(/Costo:\s*\$([\d.]+)\s*[➝→\-]+\s*\$([\d.]+)/);
    if (costo) old.precioCompra = parseFloat(costo[1]);
    const venta = desc.match(/Venta:\s*\$([\d.]+)\s*[➝→\-]+\s*\$([\d.]+)/);
    if (venta) old.precioVenta = parseFloat(venta[1]);
    const cat = desc.match(/Cat:\s*([^|➝→]+?)\s*[➝→]\s*/);
    if (cat) old.categoria = cat[1].trim();
    return Object.keys(old).length > 0 ? old : null;
  }

  get facturasAgrupadas(): GrupoFactura[] {
    const grupos = new Map<string, GrupoFactura>();
    let listaFiltrada = this.movimientos;

    if (this.textoBusqueda.trim() !== '') {
      const termino = this.textoBusqueda.toLowerCase();
      listaFiltrada = listaFiltrada.filter(mov => {
        const cod = mov.codigoProducto || ''; const nom = mov.nombreProducto || ''; const cli = mov.clienteNombre || '';
        return cod.toLowerCase().includes(termino) || nom.toLowerCase().includes(termino) || cli.toLowerCase().includes(termino);
      });
    }

    if (this.mesAnoSeleccionado) {
      listaFiltrada = listaFiltrada.filter(mov => {
        const fecha = new Date(mov.fecha);
        return `${fecha.getFullYear()}-${(fecha.getMonth() + 1).toString().padStart(2, '0')}` === this.mesAnoSeleccionado;
      });
    }

    listaFiltrada.forEach(mov => {
      const fechaReal = new Date(mov.fecha);
      const key = mov.facturaId ? mov.facturaId : `MOV-${mov.id || fechaReal.getTime()}`;

      if (!grupos.has(key)) {
        grupos.set(key, {
          id: key, fecha: fechaReal, descripcion: mov.descripcion || 'Sin descripción',
          tipoOperacion: this.obtenerTipoOperacion(mov), 
          totalUsd: 0, gananciaUsd: 0, totalBs: 0, gananciaBs: 0, 
          totalPagado: 0, totalPagadoBs: 0, gananciaRealizadaUsd: 0, gananciaRealizadaBs: 0, detalles: [], estado: 'Activo',
          clienteNombre: mov.clienteNombre || 'Cliente Genérico', clienteDocumento: mov.clienteDocumento || 'N/A',
          clienteTelefono: mov.clienteTelefono || 'N/A', clienteDireccion: mov.clienteDireccion || 'No especificada'
        });
      }

      const grupo = grupos.get(key)!;
      grupo.detalles.push(mov);

      if (mov.tipo === 'Salida' && (mov.descripcion || '').toLowerCase().includes('venta')) {
        grupo.tipoOperacion = 'Venta';
        grupo.fecha = new Date(mov.fecha); 
        grupo.descripcion = mov.descripcion || grupo.descripcion;
        if (mov.clienteNombre) grupo.clienteNombre = mov.clienteNombre;
        if (mov.clienteDocumento) grupo.clienteDocumento = mov.clienteDocumento;
        if (mov.clienteTelefono) grupo.clienteTelefono = mov.clienteTelefono;
        if (mov.clienteDireccion) grupo.clienteDireccion = mov.clienteDireccion;
      }
      
      if (mov.tipo === 'Salida' && grupo.tipoOperacion === 'Venta') {
        grupo.totalUsd += mov.valorTotalUsd; grupo.gananciaUsd += (mov.gananciaUsd || 0);
        grupo.totalBs += (mov.valorTotalBs || 0); grupo.gananciaBs += (mov.gananciaBs || 0);
      } else if (mov.tipo === 'Abono') {
        grupo.totalPagado += mov.valorTotalUsd; grupo.totalPagadoBs += mov.valorTotalBs;
      } else if (grupo.tipoOperacion !== 'Venta' && mov.tipo !== 'Abono' && mov.tipo !== 'Anulacion' && mov.tipo !== 'Modificación') {
        grupo.totalUsd += mov.valorTotalUsd; grupo.totalBs += (mov.valorTotalBs || 0);
      }
    });

    let resultadoFinal = Array.from(grupos.values());
    
    resultadoFinal.forEach(grupo => {
      if (grupo.detalles.some(d => d.tipo === 'Anulacion')) grupo.estado = 'Anulado';
      grupo.detalles.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      // Si está anulado, hacemos que el tipoOperacion y la descripción reflejen
      // la operación ORIGINAL, no el sello "Operación Anulada". Sin esto, en el
      // Excel y en la UI los registros iniciales / ajustes anulados se ven como
      // "Ajuste — Operación Anulada", sin saber qué fue.
      if (grupo.estado === 'Anulado') {
        const original = grupo.detalles.find(d => d.tipo !== 'Anulacion' && d.tipo !== 'Abono');
        if (original) {
          grupo.tipoOperacion = this.obtenerTipoOperacion(original);
          if (original.descripcion) grupo.descripcion = original.descripcion;
          // Para ventas anuladas, también restauramos el nombre del cliente
          if (grupo.tipoOperacion === 'Venta' && original.clienteNombre) {
            grupo.clienteNombre = original.clienteNombre;
            if (original.clienteDocumento) grupo.clienteDocumento = original.clienteDocumento;
            if (original.clienteTelefono) grupo.clienteTelefono = original.clienteTelefono;
            if (original.clienteDireccion) grupo.clienteDireccion = original.clienteDireccion;
          }
        }
      }

      if (grupo.tipoOperacion === 'Venta') {
        const costoUsd = grupo.totalUsd - grupo.gananciaUsd;
        const costoBs = grupo.totalBs - grupo.gananciaBs; 
        let porcentajePagado = grupo.totalUsd > 0 ? (grupo.totalPagado / grupo.totalUsd) : 0;
        if (porcentajePagado > 1) porcentajePagado = 1;
        grupo.gananciaRealizadaUsd = grupo.totalPagado - (costoUsd * porcentajePagado);
        grupo.gananciaRealizadaBs = grupo.totalPagadoBs - (costoBs * porcentajePagado);
      }
    });

    resultadoFinal.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

    if (this.tipoSeleccionado !== 'Todos') {
      if (this.tipoSeleccionado === 'Entradas') resultadoFinal = resultadoFinal.filter(g => g.tipoOperacion === 'Entrada Inicial' || g.tipoOperacion === 'Entrada');
      else if (this.tipoSeleccionado === 'Ventas') resultadoFinal = resultadoFinal.filter(g => g.tipoOperacion === 'Venta');
      else if (this.tipoSeleccionado === 'Ajustes') resultadoFinal = resultadoFinal.filter(g => g.tipoOperacion === 'Ajuste' || g.tipoOperacion === 'Avería' || g.tipoOperacion === 'Modificación');
      else if (this.tipoSeleccionado === 'PorCobrar') {
        resultadoFinal = resultadoFinal.filter(g => g.tipoOperacion === 'Venta' && (g.totalPagado < g.totalUsd - 0.01) && g.estado !== 'Anulado');
      }
    }

    return resultadoFinal;
  }

  get totalPaginas(): number { return Math.ceil(this.facturasAgrupadas.length / this.itemsPorPagina) || 1; }
  get facturasPaginadas(): GrupoFactura[] { const inicio = (this.paginaActual - 1) * this.itemsPorPagina; return this.facturasAgrupadas.slice(inicio, inicio + this.itemsPorPagina); }
  cambiarPagina(direccion: number) { const nueva = this.paginaActual + direccion; if (nueva >= 1 && nueva <= this.totalPaginas) this.paginaActual = nueva; }

  exportarHistorialExcel() {
    const listadoExportar = this.facturasAgrupadas; 
    if (listadoExportar.length === 0) {
      this.notifications.warning('No hay datos para exportar con los filtros actuales.');
      return;
    }

    const datosExcel: Record<string, string | number>[] = [];
    const rowConfig: { level: number; hidden?: boolean }[] = [];
    let currentRow = 1; 

    listadoExportar.forEach(grupo => {
      const esVenta = grupo.tipoOperacion === 'Venta';
      
      datosExcel.push({
        'Fecha': new Date(grupo.fecha).toLocaleString(),
        'N° Referencia': grupo.id,
        'Tipo': grupo.tipoOperacion,
        'Estado': grupo.estado,
        'Cliente / Motivo': esVenta ? grupo.clienteNombre : grupo.descripcion,
        'Cód. Producto': '[TOTAL OPERACIÓN]',
        'Descripción Producto': `${grupo.detalles.length} movimiento(s)`,
        'Cant.': '',
        'Total ($)': esVenta ? Math.abs(grupo.totalPagado) : Math.abs(grupo.totalUsd),
        'Ganancia ($)': esVenta ? Math.abs(grupo.gananciaRealizadaUsd) : 0,
        'Total (Bs)': esVenta ? Math.abs(grupo.totalPagadoBs) : Math.abs(grupo.totalBs),
        'Ganancia (Bs)': esVenta ? Math.abs(grupo.gananciaRealizadaBs) : 0,
      });

      rowConfig.push({ level: 0 });
      currentRow++;

      grupo.detalles.forEach(det => {
        datosExcel.push({
          'Fecha': new Date(det.fecha).toLocaleString(),
          'N° Referencia': grupo.id,
          'Tipo': det.tipo,
          'Estado': grupo.estado,
          'Cliente / Motivo': det.descripcion || '',
          'Cód. Producto': det.codigoProducto,
          'Descripción Producto': det.nombreProducto,
          'Cant.': Math.abs(det.cantidad),
          'Total ($)': Math.abs(det.valorTotalUsd),
          'Ganancia ($)': Math.abs(det.gananciaUsd || 0),
          'Total (Bs)': Math.abs(det.valorTotalBs || 0),
          'Ganancia (Bs)': Math.abs(det.gananciaBs || 0),
        });

        rowConfig.push({ level: 1, hidden: true });
        currentRow++;
      });
    });

    const hoja = XLSX.utils.json_to_sheet(datosExcel);
    hoja['!rows'] = rowConfig;

    hoja['!cols'] = [
      { wch: 20 }, { wch: 18 }, { wch: 15 }, { wch: 10 }, { wch: 30 },
      { wch: 18 }, { wch: 30 }, { wch: 8 },  { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 15 }
    ];

    const rango = XLSX.utils.decode_range(hoja['!ref'] || 'A1:L1');
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: c });
      if (!hoja[cellAddress]) continue;
      hoja[cellAddress].s = {
        fill: { fgColor: { rgb: "000000" } },
        font: { color: { rgb: "FFFFFF" }, bold: true },
        alignment: { horizontal: "center", vertical: "center" }
      };
    }

    for (let r = 1; r < currentRow; r++) {
      if (rowConfig[r - 1] && rowConfig[r - 1].level === 0) {
        for (let c = 0; c <= rango.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r: r, c: c });
          if (hoja[cellAddr]) {
            hoja[cellAddr].s = { font: { bold: true }, fill: { fgColor: { rgb: "F2F2F2" } } };
          }
        }
      }
    }

    const libro = XLSX.utils.book_new();
    const nombreFiltro = this.tipoSeleccionado.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    XLSX.utils.book_append_sheet(libro, hoja, 'Historial_Operaciones');
    XLSX.writeFile(libro, `Historial_${nombreFiltro}.xlsx`);
  }
}
