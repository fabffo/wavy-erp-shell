import { Routes } from '@angular/router';
import { Component } from '@angular/core';

@Component({ standalone: true, template: '' })
class RouteAnchorComponent {}

export const routes: Routes = [
  { path: 'connexion', component: RouteAnchorComponent },
  { path: 'dashboard', component: RouteAnchorComponent },
  { path: 'module', component: RouteAnchorComponent },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
