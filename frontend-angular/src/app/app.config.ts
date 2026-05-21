import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { httpErrorInterceptor } from './core/http-error.interceptor';
import { loadingInterceptor } from './core/loading.interceptor';

/**
 * Configuración de inyección de dependencias raíz.
 *
 * Nota: NO usamos Angular Router. La aplicación es una SPA de Electron con
 * una sola pantalla y vistas internas controladas por `inventoryService.vistaActual`
 * y los atajos de teclado en `App`. El router añadiría complejidad sin beneficio
 * (sin URLs externas que compartir, sin deep links, sin lazy loading necesario).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    // El loading interceptor se registra ANTES que el error interceptor para
    // que la barra de carga se apague aun cuando la respuesta sea un error.
    provideHttpClient(withInterceptors([loadingInterceptor, httpErrorInterceptor]))
  ]
};
