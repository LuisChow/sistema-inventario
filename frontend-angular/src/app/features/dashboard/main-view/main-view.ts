import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductList } from '../../inventory/product-list/product-list';
import { ProductForm } from '../../inventory/product-form/product-form';
import { StockMoves } from '../../inventory/stock-moves/stock-moves';
import { SettingsView } from '../../settings/settings-view/settings-view';
import { InventoryService } from '../../../core/inventory';

@Component({
  selector: 'app-main-view',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductList, ProductForm, StockMoves, SettingsView],
  templateUrl: './main-view.html',
  styleUrl: './main-view.css'
})
export class MainView implements OnInit {
  public inventoryService = inject(InventoryService);

  ngOnInit() {
    this.inventoryService.cargarRepuestosDesdeBD();
    this.inventoryService.cargarMovimientosDesdeBD();
  }

  actualizarEstadisticas() {
  }
}