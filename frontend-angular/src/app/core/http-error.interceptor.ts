import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { inject } from '@angular/core';
import { NotificationService } from './notification.service';

/**
 * Captura cualquier error HTTP del backend y muestra un toast claro.
 * Antes, todas las llamadas `.subscribe()` ignoraban los errores y la UI se quedaba
 * en silencio si el servidor fallaba. Esto soluciona ese problema de forma centralizada.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const apiMessage = err?.error?.error || err?.error?.mensaje || err?.message;
      let message: string;
      let title = 'Error';

      if (err.status === 0) {
        title = 'Sin conexión';
        message = 'No se pudo conectar con el servidor. Verifica que el sistema esté corriendo.';
      } else if (err.status >= 500) {
        title = 'Error del servidor';
        message = apiMessage || `Algo falló en el backend (${err.status}). Intenta de nuevo.`;
      } else if (err.status === 400) {
        title = 'Datos inválidos';
        message = apiMessage || 'Revisa los datos enviados.';
      } else if (err.status === 404) {
        title = 'No encontrado';
        message = apiMessage || 'No se encontró el recurso solicitado.';
      } else if (err.status === 409) {
        title = 'Conflicto';
        message = apiMessage || 'Conflicto al guardar los datos.';
      } else {
        message = apiMessage || `Error inesperado (HTTP ${err.status || '?'}).`;
      }

      notifications.error(message, title);
      return throwError(() => err);
    })
  );
};
