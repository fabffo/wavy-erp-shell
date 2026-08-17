import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { WavyContextService } from './wavy-context.service';

describe('WavyContextService', () => {
  let service: WavyContextService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(WavyContextService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('partage le profil et le changement de société avec le module Factures', () => {
    service.login('admin@wavy.fr', 'secret').subscribe();
    http.expectOne('/api/auth/login').flush({ email: 'admin@wavy.fr', roles: ['ADMIN_TENANT'] });
    http.expectOne('/api/profil').flush({
      utilisateurId: 7,
      email: 'admin@wavy.fr',
      nom: 'Admin Wavy',
      roles: ['ADMIN_TENANT'],
      permissions: ['FACTURES_LECTURE'],
      tenantId: 2,
      tenantNom: 'Wavy',
      societeCouranteId: 10,
      societesAutorisees: [{ id: 10, nom: 'Wavy Services' }, { id: 11, nom: 'Wavy Conseil' }],
    });

    expect(JSON.parse(localStorage.getItem('wavy.factures.profil') ?? '{}')).toMatchObject({
      utilisateurId: 7,
      societeCouranteId: 10,
      societeCouranteNom: 'Wavy Services',
    });

    service.selectCompany(11);
    expect(JSON.parse(localStorage.getItem('wavy.factures.profil') ?? '{}')).toMatchObject({
      societeCouranteId: 11,
      societeCouranteNom: 'Wavy Conseil',
    });
  });

  it('supprime le profil partagé à la déconnexion', () => {
    localStorage.setItem('wavy.factures.profil', '{}');
    service.logout();
    http.expectOne('/api/auth/session').flush(null);
    expect(localStorage.getItem('wavy.factures.profil')).toBeNull();
  });

  it('limite un comptable aux modules Factures et Trésorerie', () => {
    service.update({ roles: ['COMPTABLE'] });
    expect(service.canAccessModule('factures')).toBe(true);
    expect(service.canAccessModule('tresorerie')).toBe(true);
    expect(service.canAccessModule('tiers')).toBe(false);
    expect(service.canAccessModule('socle')).toBe(false);
  });

  it('autorise la consultation métier mais pas l’administration en lecture seule', () => {
    service.update({ roles: ['LECTURE_SEULE'], readOnly: true });
    expect(service.canAccessModule('tiers')).toBe(true);
    expect(service.canAccessModule('contrats')).toBe(true);
    expect(service.canAccessModule('socle')).toBe(false);
    expect(service.value().readOnly).toBe(true);
  });

  it('autorise un utilisateur actif par son tenant et sa société sans rôle ERP dédié', () => {
    service.login('gestionnaire@wavy.fr', 'secret').subscribe();
    http.expectOne('/api/auth/login').flush({ email: 'gestionnaire@wavy.fr', roles: ['GESTIONNAIRE'] });
    http.expectOne('/api/profil').flush({
      utilisateurId: 21,
      email: 'gestionnaire@wavy.fr',
      prenom: 'Marie',
      nom: 'Martin',
      tenantId: 3,
      tenantNom: 'Tenant Démo',
      societeCouranteId: 31,
      societesAutorisees: [{ id: 31, nom: 'Société Démo' }],
      roles: ['GESTIONNAIRE'],
    });

    expect(service.authenticated()).toBe(true);
    expect(service.value()).toMatchObject({ nom: 'Marie Martin', tenantId: 3, societeNom: 'Société Démo' });
  });

  it('refuse un utilisateur qui ne possède aucune société autorisée', () => {
    service.login('sans-societe@wavy.fr', 'secret').subscribe({ error: () => undefined });
    http.expectOne('/api/auth/login').flush({ email: 'sans-societe@wavy.fr', roles: ['GESTIONNAIRE'] });
    http.expectOne('/api/profil').flush({
      utilisateurId: 22,
      email: 'sans-societe@wavy.fr',
      tenantId: 3,
      roles: ['GESTIONNAIRE'],
      societesAutorisees: [],
    });

    expect(service.authenticated()).toBe(false);
    expect(service.authError()).toContain('Aucune société');
    expect(sessionStorage.getItem('wavy.erp.session.v1')).toBeNull();
  });

  it('refuse un utilisateur sans tenant', () => {
    service.login('sans-tenant@wavy.fr', 'secret').subscribe({ error: () => undefined });
    http.expectOne('/api/auth/login').flush({ email: 'sans-tenant@wavy.fr', roles: ['GESTIONNAIRE'] });
    http.expectOne('/api/profil').flush({
      utilisateurId: 23,
      email: 'sans-tenant@wavy.fr',
      societesAutorisees: [{ id: 31, nom: 'Société Démo' }],
      roles: ['GESTIONNAIRE'],
    });

    expect(service.authenticated()).toBe(false);
    expect(service.authError()).toContain('rattaché à un tenant');
  });
});
