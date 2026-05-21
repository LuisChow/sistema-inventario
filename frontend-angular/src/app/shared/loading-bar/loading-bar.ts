import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoadingService } from '../../core/loading.service';

@Component({
  selector: 'app-loading-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (service.loading()) {
      <div class="loading-bar" role="progressbar" aria-label="Cargando">
        <div class="loading-bar-track"></div>
      </div>
    }
  `,
  styles: [`
    .loading-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 100001;
      overflow: hidden;
      background: transparent;
      pointer-events: none;
    }
    .loading-bar-track {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 40%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
      animation: loadingSweep 1.2s ease-in-out infinite;
    }
    @keyframes loadingSweep {
      0%   { left: -40%; }
      100% { left: 100%; }
    }
  `]
})
export class LoadingBar {
  public service = inject(LoadingService);
}
