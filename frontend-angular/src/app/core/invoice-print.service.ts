import { Injectable, inject } from '@angular/core';
import { ConfigService, EmpresaConfig } from './config.service';
import { NotificationService } from './notification.service';

/**
 * Representa una factura imprimible. La armamos desde el agrupador de
 * `stock-moves` o desde el carrito en el momento de la venta.
 */
export interface FacturaImprimible {
  id: string;
  fecha: Date | string;
  cliente: {
    nombre: string;
    documento?: string;
    telefono?: string;
    direccion?: string;
  };
  items: Array<{
    codigo: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    total: number;
  }>;
  totalUsd: number;
  totalBs: number;
  pagado: number;
  pagadoBs: number;
  metodoPago: string;
  estado: string;
}

/**
 * Genera y abre una ventana lista para imprimir con una factura formateada.
 *
 * En lugar de usar una librería pesada como jsPDF, generamos HTML estilizado
 * y aprovechamos el diálogo de impresión del navegador / Electron, que ya
 * incluye "Guardar como PDF". Resulta más ligero, más bonito, y más portable.
 */
@Injectable({ providedIn: 'root' })
export class InvoicePrintService {
  private config = inject(ConfigService);
  private notifications = inject(NotificationService);

  imprimirFactura(factura: FacturaImprimible): void {
    const empresa = this.config.config();
    const html = this.generarHtml(factura, empresa);

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      this.notifications.error(
        'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para esta aplicación.',
        'Impresión bloqueada'
      );
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();

    // Damos un instante para que el navegador renderice imágenes (logo) antes
    // de abrir el diálogo de impresión.
    const lanzarImpresion = () => {
      w.focus();
      w.print();
    };
    if (w.document.readyState === 'complete') {
      setTimeout(lanzarImpresion, 200);
    } else {
      w.onload = () => setTimeout(lanzarImpresion, 200);
    }
  }

  private generarHtml(f: FacturaImprimible, e: EmpresaConfig): string {
    const fechaFmt = new Date(f.fecha).toLocaleString('es-VE');
    const pendiente = Math.max(0, f.totalUsd - f.pagado);
    const pendienteBs = Math.max(0, f.totalBs - f.pagadoBs);
    const esCredito = f.metodoPago === 'Credito';

    const filas = f.items.map(item => `
      <tr>
        <td>${escape(item.codigo)}</td>
        <td>${escape(item.descripcion)}</td>
        <td class="num">${item.cantidad}</td>
        <td class="num">$${money(item.precioUnitario)}</td>
        <td class="num">$${money(item.total)}</td>
      </tr>
    `).join('');

    const logoHtml = e.empresa_logo
      ? `<img src="${e.empresa_logo}" alt="logo" class="logo" />`
      : '';

    const mensajeFinal = e.empresa_mensaje
      ? `<div class="mensaje-final">${escape(e.empresa_mensaje)}</div>`
      : '';

    // Marca de agua de "ANULADO" cuando la factura fue revertida. Se imprime
    // diagonal sobre toda la página y también queda visible en pantalla.
    const watermark = f.estado === 'Anulado'
      ? `<div class="watermark-anulado">ANULADO</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Factura ${escape(f.id)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1d20;
    margin: 0;
    padding: 32px 40px;
    background: white;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1a1d20;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .empresa { display: flex; gap: 16px; align-items: flex-start; }
  .logo { max-width: 80px; max-height: 80px; object-fit: contain; }
  .empresa-datos h1 { margin: 0 0 4px 0; font-size: 1.4rem; }
  .empresa-datos p { margin: 2px 0; font-size: 0.85rem; color: #555; }
  .factura-meta { text-align: right; }
  .factura-meta h2 { margin: 0 0 8px 0; font-size: 1.6rem; color: #1a1d20; }
  .factura-meta p { margin: 2px 0; font-size: 0.9rem; }
  .factura-id { font-weight: bold; }
  .estado {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 0.85rem;
    text-transform: uppercase;
    margin-top: 6px;
  }
  .estado-pagado  { background: #d4edda; color: #155724; }
  .estado-abono   { background: #fff3cd; color: #856404; }
  .estado-pendiente { background: #f8d7da; color: #721c24; }
  .cliente {
    background: #f8f9fa;
    border-radius: 6px;
    padding: 14px 16px;
    margin-bottom: 24px;
  }
  .cliente h3 {
    margin: 0 0 8px 0;
    font-size: 0.95rem;
    text-transform: uppercase;
    color: #555;
    letter-spacing: 0.5px;
  }
  .cliente-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 24px;
    font-size: 0.9rem;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
    font-size: 0.92rem;
  }
  table.items thead {
    background: #1a1d20;
    color: white;
  }
  table.items th, table.items td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid #dee2e6;
  }
  table.items .num { text-align: right; }
  .totales {
    margin-left: auto;
    width: 320px;
    font-size: 0.95rem;
  }
  .totales .linea {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
  }
  .totales .linea.total {
    font-size: 1.15rem;
    font-weight: bold;
    border-top: 2px solid #1a1d20;
    padding-top: 10px;
    margin-top: 6px;
  }
  .totales .pendiente { color: #c00; font-weight: bold; }
  .mensaje-final {
    margin-top: 32px;
    padding: 14px;
    text-align: center;
    font-style: italic;
    color: #555;
    border-top: 1px dashed #999;
  }
  .pie {
    margin-top: 32px;
    font-size: 0.75rem;
    color: #888;
    text-align: center;
  }
  .watermark-anulado {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 11rem;
    font-weight: 900;
    color: rgba(229, 72, 77, 0.25);
    letter-spacing: 1.5rem;
    pointer-events: none;
    user-select: none;
    z-index: 1000;
    text-shadow: 0 0 4px rgba(229, 72, 77, 0.4);
  }
  @media print {
    body { padding: 12mm 14mm; }
    @page { size: A4; margin: 0; }
    .watermark-anulado { color: rgba(229, 72, 77, 0.35); }
  }
</style>
</head>
<body>
  ${watermark}
  <div class="header">
    <div class="empresa">
      ${logoHtml}
      <div class="empresa-datos">
        <h1>${escape(e.empresa_nombre || 'Mi Empresa')}</h1>
        ${e.empresa_rif       ? `<p><strong>RIF:</strong> ${escape(e.empresa_rif)}</p>` : ''}
        ${e.empresa_direccion ? `<p>${escape(e.empresa_direccion)}</p>` : ''}
        ${e.empresa_telefono  ? `<p>Tel: ${escape(e.empresa_telefono)}</p>` : ''}
        ${e.empresa_email     ? `<p>${escape(e.empresa_email)}</p>` : ''}
      </div>
    </div>
    <div class="factura-meta">
      <h2>FACTURA</h2>
      <p class="factura-id">N° ${escape(f.id)}</p>
      <p>Fecha: ${fechaFmt}</p>
      <p>Método: <strong>${escape(f.metodoPago)}</strong></p>
      <span class="estado estado-${estadoClase(f, pendiente)}">${escape(estadoTexto(f, pendiente))}</span>
    </div>
  </div>

  <div class="cliente">
    <h3>Cliente</h3>
    <div class="cliente-grid">
      <div><strong>Nombre:</strong> ${escape(f.cliente.nombre)}</div>
      ${f.cliente.documento ? `<div><strong>Documento:</strong> ${escape(f.cliente.documento)}</div>` : '<div></div>'}
      ${f.cliente.telefono  ? `<div><strong>Teléfono:</strong> ${escape(f.cliente.telefono)}</div>` : '<div></div>'}
      ${f.cliente.direccion ? `<div><strong>Dirección:</strong> ${escape(f.cliente.direccion)}</div>` : '<div></div>'}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:14%;">Código</th>
        <th>Descripción</th>
        <th class="num" style="width:9%;">Cant.</th>
        <th class="num" style="width:14%;">P. Unit.</th>
        <th class="num" style="width:14%;">Total</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <div class="totales">
    <div class="linea">
      <span>Subtotal USD</span>
      <span>$${money(f.totalUsd)}</span>
    </div>
    <div class="linea">
      <span>Subtotal Bs</span>
      <span>${money(f.totalBs)} Bs</span>
    </div>
    <div class="linea total">
      <span>TOTAL</span>
      <span>$${money(f.totalUsd)}</span>
    </div>
    ${esCredito || pendiente > 0.01 ? `
      <div class="linea">
        <span>Pagado</span>
        <span>$${money(f.pagado)}</span>
      </div>
      <div class="linea pendiente">
        <span>Por cobrar</span>
        <span>$${money(pendiente)} / ${money(pendienteBs)} Bs</span>
      </div>
    ` : ''}
  </div>

  ${mensajeFinal}

  <div class="pie">
    Generado por Inventario Chow · ${new Date().toLocaleString('es-VE')}
  </div>
</body>
</html>`;
  }
}

function money(n: number): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escape(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function estadoTexto(f: FacturaImprimible, pendiente: number): string {
  if (f.estado === 'Anulado') return 'Anulado';
  if (pendiente <= 0.01) return 'Pagado';
  if (f.pagado > 0) return 'Abono';
  return 'Pendiente';
}

function estadoClase(f: FacturaImprimible, pendiente: number): string {
  if (f.estado === 'Anulado') return 'pendiente';
  if (pendiente <= 0.01) return 'pagado';
  if (f.pagado > 0) return 'abono';
  return 'pendiente';
}
