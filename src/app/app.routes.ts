import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'connexion' },
  { path: 'dashboard' },
  { path: 'module' },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
