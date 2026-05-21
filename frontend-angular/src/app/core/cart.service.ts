import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Repuesto } from './inventory';
import { NotificationService } from './notification.service';

/**
 * Item dentro del carrito de venta. `subtotal` se recalcula cada vez que
 * la cantidad cambia para que el template no tenga que hacerlo.
 */
export interface ItemCarrito {
  producto: Repuesto;
  cantidadVendida: number;
  subtotal: number;
}

/**
 * Estado del carrito de ventas. Antes vivía dentro de `InventoryService` junto
 * con la lógica de inventario, dashboard y pagos. Lo separamos porque
 * conceptualmente es estado de UI (vida útil corta, sólo para la venta en
 * curso), independiente del inventario en sí.
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  private notifications = inject(NotificationService);

  private carritoSubject = new BehaviorSubject<ItemCarrito[]>([]);
  public carrito$ = this.carritoSubject.asObservable();

  /** Lectura síncrona del carrito (para el procesamiento de la venta). */
  get items(): ItemCarrito[] {
    return this.carritoSubject.value;
  }

  /** Suma total del carrito en USD. */
  get totalCarrito(): number {
    return this.items.reduce((t, i) => t + i.subtotal, 0);
  }

  /** Agrega un producto al carrito o incrementa su cantidad si ya está. */
  agregarAlCarrito(r: Repuesto, cantidadIngresada: number | string): void {
    const c = Number(cantidadIngresada);
    if (isNaN(c) || c <= 0) return;
    const actual = [...this.items];
    const idx = actual.findIndex(i => i.producto.codigo === r.codigo);

    if (idx !== -1) {
      const total = actual[idx].cantidadVendida + c;
      if (total > r.cantidad) {
        this.notifications.warning(
          `Stock insuficiente para "${r.nombre}". Disponible: ${r.cantidad}.`
        );
        return;
      }
      actual[idx].cantidadVendida = total;
      actual[idx].subtotal = total * r.precioVenta;
    } else {
      if (c > r.cantidad) {
        this.notifications.warning(
          `Stock insuficiente para "${r.nombre}". Disponible: ${r.cantidad}.`
        );
        return;
      }
      actual.push({ producto: r, cantidadVendida: c, subtotal: c * r.precioVenta });
    }
    this.carritoSubject.next(actual);
  }

  quitarDelCarrito(codigo: string): void {
    this.carritoSubject.next(this.items.filter(i => i.producto.codigo !== codigo));
  }

  vaciarCarrito(): void {
    this.carritoSubject.next([]);
  }
}
