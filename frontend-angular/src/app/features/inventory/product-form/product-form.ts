import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventoryService, Repuesto } from '../../../core/inventory';
import { NotificationService } from '../../../core/notification.service';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './product-form.html',
  styleUrl: './product-form.css'
})
export class ProductForm {
  public inventoryService = inject(InventoryService);
  private notifications = inject(NotificationService);

  nuevaCatTexto: string = '';
  categoriaAEliminar: string | null = null;

  nuevoProducto: Repuesto = { codigo: '', nombre: '', categoria: this.inventoryService.categorias[0] || 'General', cantidad: 1, precioCompra: 0, precioVenta: 0 };

  guardarProducto() {
    if (!this.nuevoProducto.codigo || !this.nuevoProducto.nombre) {
      this.notifications.warning('Código y nombre son obligatorios.');
      return;
    }

    // Congelamos el costo en Bs usando la tasa de la interfaz
    const productoConBs = {
      ...this.nuevoProducto,
      precioCompraBs: this.nuevoProducto.precioCompra * this.inventoryService.tasaCambio
    };

    this.inventoryService.agregarRepuesto(productoConBs);
    this.nuevoProducto = { codigo: '', nombre: '', categoria: this.nuevoProducto.categoria, cantidad: 1, precioCompra: 0, precioVenta: 0 };
  }

  agregarCat() {
    const nuevaCat = this.nuevaCatTexto.trim();

    if (nuevaCat) {
      this.inventoryService.agregarCategoria(nuevaCat);

      if (!this.inventoryService.categorias.includes(nuevaCat)) {
        this.inventoryService.categorias = [...this.inventoryService.categorias, nuevaCat];
      }

      setTimeout(() => {
        this.nuevoProducto.categoria = nuevaCat;
      }, 50);

      this.nuevaCatTexto = '';
    }
  }

  abrirModalEliminarCat() {
    if (this.inventoryService.categorias.length <= 1) {
      this.notifications.warning('No puedes eliminar la última categoría.');
      return;
    }

    const catAEliminar = this.nuevoProducto.categoria;
    const productosEnUso = this.inventoryService.inventarioActual.filter(p => p.categoria === catAEliminar);

    if (productosEnUso.length > 0) {
      const codigos = productosEnUso.map(p => p.codigo).join(', ');
      this.notifications.error(
        `No puedes eliminar la categoría "${catAEliminar}" porque está en uso.\n\nDebes cambiar la categoría de los siguientes productos primero:\n${codigos}`,
        'Categoría en uso',
        8000
      );
      return;
    }

    this.categoriaAEliminar = catAEliminar;
  }

  ejecutarEliminarCat() {
    if (this.categoriaAEliminar) {
      this.inventoryService.eliminarCategoria(this.categoriaAEliminar);
      this.inventoryService.categorias = this.inventoryService.categorias.filter(c => c !== this.categoriaAEliminar);
      this.nuevoProducto.categoria = this.inventoryService.categorias[0] || 'General';
      this.notifications.success(`Categoría "${this.categoriaAEliminar}" eliminada.`);
      this.categoriaAEliminar = null;
    }
  }
}
