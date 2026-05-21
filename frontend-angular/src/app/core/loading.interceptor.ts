import { HttpInterceptorFn } from '@angular/common/http';
import { finalize } from 'rxjs';
import { inject } from '@angular/core';
import { LoadingService } from './loading.service';

/**
 * Incrementa el contador de carga al iniciar cualquier petición HTTP, y lo
 * decrementa cuando termina (éxito o error). Se combina con `LoadingBar`
 * para mostrar una barra de progreso en la parte superior de la app.
 */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const loading = inject(LoadingService);
  loading.start();
  return next(req).pipe(finalize(() => loading.end()));
};
