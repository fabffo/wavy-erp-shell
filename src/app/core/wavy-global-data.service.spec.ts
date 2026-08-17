import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { WavyGlobalDataService } from './wavy-global-data.service';

describe('WavyGlobalDataService', () => {
  let service: WavyGlobalDataService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(WavyGlobalDataService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('agrège les résultats des modules avec leurs routes métier', () => {
    let paths: string[] = [];
    service.search('PATENRIA').subscribe((results) => paths = results.map((item) => item.path));
    http.expectOne((request) => request.url === '/api/tiers/search' && request.params.get('query') === 'PATENRIA').flush([{ id: 22, raisonSociale: 'PATENRIA' }]);
    http.expectOne('/api/contrats').flush([{ id: 7, numeroContrat: 'CC-PATENRIA' }]);
    http.expectOne((request) => request.url === '/api/factures/ventes' && request.params.get('recherche') === 'PATENRIA').flush([{ id: 4, numeroFacture: 'FAC-004' }]);
    http.expectOne((request) => request.url === '/api/factures/achats' && request.params.get('recherche') === 'PATENRIA').flush([]);
    http.expectOne((request) => request.url === '/api/tresorerie/operations-bancaires' && request.params.get('libelle') === 'PATENRIA').flush({ content: [{ id: 9, libelle: 'VIR PATENRIA' }] });
    expect(paths).toEqual(['/tiers/22', '/contrats/7', '/factures/ventes/4', '/tresorerie?vue=operations&operationId=9']);
  });

  it('construit les notifications à partir des KPI et opérations', () => {
    let counts: number[] = [];
    service.notifications().subscribe((items) => counts = items.map((item) => item.count));
    http.expectOne('/api/tresorerie/factures-echeances/kpis').flush({ nombreFacturesEnRetard: 3, echeancesA7Jours: 2 });
    http.expectOne((request) => request.url === '/api/tresorerie/operations-bancaires' && request.params.get('statutRapprochement') === 'NON_RAPPROCHEE').flush({ totalElements: 12, content: [] });
    expect(counts).toEqual([3, 2, 12]);
  });

  it('agrège le tableau de bord ERP', () => {
    let dashboard: { chiffreAffaires: number | null; tresorerie: number | null; contratsActifs: number | null; alertes: number } | undefined;
    service.dashboard().subscribe((value) => dashboard = value);
    http.expectOne((request) => request.url === '/api/dashboard-financier' && !!request.params.get('dateDebut') && !!request.params.get('dateFin')).flush({ kpis: { chiffreAffairesHt: 250000, margeNette: 42000 } });
    http.expectOne('/api/tresorerie/dashboard').flush({ soldeTotal: 44304, operationsARapprocher: 12 });
    http.expectOne('/api/tresorerie/factures-echeances/kpis').flush({ aEncaisser: 90000, aPayer: 45000, nombreFacturesEnRetard: 3 });
    http.expectOne('/api/contrats').flush([{ id: 1, statut: 'ACTIF' }, { id: 2, statut: 'TERMINE' }]);
    expect(dashboard).toMatchObject({ chiffreAffaires: 250000, tresorerie: 44304, contratsActifs: 1, alertes: 15 });
  });
});
