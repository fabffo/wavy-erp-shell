import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { WavyContextService } from './wavy-context.service';

export const wavyHttpInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api')) return next(request);
  const service = inject(WavyContextService);
  const router = inject(Router);
  return next(request.clone({ withCredentials: true })).pipe(catchError((error) => {
    if (error.status === 401 && !request.url.includes('/api/auth/session')) {
      service.logout();
      void router.navigate(['/connexion'], { queryParams: { returnUrl: router.url } });
    } else if (error.status === 403) {
      service.authError.set('Vous n’avez pas les droits nécessaires.');
    }
    return throwError(() => error);
  }));
};
