import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { PwaIntegrationService } from './core/pwa-integration.service';
import { App } from './app';
import { routes } from './app.routes';
import { WavyContextService } from './core/wavy-context.service';
import { WavyGlobalDataService } from './core/wavy-global-data.service';

describe('Navigation Shell', () => {
  const value = signal({ utilisateurId: 1, tenantId: 2, societeInterneId: 3, nom: 'Test', email: 'test@example.test', societeNom: 'A', roles: [], readOnly: false });
  const loading = signal(false); const authenticated = signal(true);
  const context = { value, bootstrap: vi.fn(), authenticated, loading,
    canAccessModule: () => authenticated(), hasRole: () => true, authError: signal(''), companies: () => [], broadcast: vi.fn(), receive: vi.fn() };
  const dashboard = { chiffreAffaires: 0, margeNette: 0, tresorerie: 0, aEncaisser: 0, aPayer: 0, rapprochementsAValider: 0, contratsActifs: 0, alertes: 0 };
  beforeEach(async () => {
    loading.set(false); authenticated.set(true);
    value.set({ ...value(), societeInterneId: 3 });
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes),
      { provide: PwaIntegrationService, useValue: { enabled: signal(false), loading: signal(false) } },
      { provide: WavyContextService, useValue: context },
      { provide: WavyGlobalDataService, useValue: { notifications: () => of([]), dashboard: () => of(dashboard) } }],
    }).compileComponents();
  });
  it('transmet les chemins et leurs filtres pour chaque entree du menu', async () => {
    const fixture = TestBed.createComponent(App); const app = fixture.componentInstance; const router = TestBed.inject(Router);
    const entries = app.groups.flatMap(g => g.entries);
    expect(entries.find(e => e.label === 'Contrats clients')?.path).toBe('/contrats?type=CLIENT');
    expect(entries.find(e => e.label === 'Contrats fournisseurs')?.path).toBe('/contrats?type=FOURNISSEUR');
    expect(entries.find(e => e.label === 'Fournisseurs')?.path).toBe('/tiers/role/fournisseur');
    expect(entries.find(e => e.label === 'Contacts')?.path).toBe('/tiers/role/contact');
    expect(entries.find(e => e.label === 'Références contractuelles')?.path).toBe('/references');
    for (const entry of entries) {
      app.open(entry); await fixture.whenStable();
      expect(router.parseUrl(router.url).queryParams['path']).toBe(entry.path);
      expect(router.parseUrl(router.url).queryParams['module']).toBe(entry.module);
    }
  });
  it('transmet les filtres de tous les raccourcis du tableau de bord', async () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges(); await fixture.whenStable();
    const open = vi.spyOn(fixture.componentInstance, 'open').mockImplementation(() => {});
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.kpis button, .panels article:first-child button')) as HTMLButtonElement[];
    const paths = ['/dashboard-financier', '/dashboard-financier', '/tresorerie?vue=dashboard',
      '/tresorerie?vue=factures-echeances&vueEcheances=A_ENCAISSER', '/tresorerie?vue=factures-echeances&vueEcheances=A_PAYER',
      '/tresorerie?vue=rapprochements', '/contrats?statut=ACTIF', null,
      '/factures/ventes/nouveau', '/tiers/nouveau', '/tresorerie?vue=rapprochements'];
    expect(buttons).toHaveLength(paths.length);
    for (const [index, button] of buttons.entries()) {
      if (!paths[index]) continue;
      button.click(); await fixture.whenStable();
      expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ path: paths[index] }));
    }
  });
  it('conserve URL et filtres pendant la restauration asynchrone de session', async () => {
    loading.set(true); authenticated.set(false);
    const router = TestBed.inject(Router);
    await router.navigate(['/module'], { queryParams: { module: 'contrats', path: '/contrats?type=CLIENT' } });
    const fixture = TestBed.createComponent(App); const app = fixture.componentInstance;
    fixture.detectChanges(); expect(app.frame()).toBeNull();
    authenticated.set(true); loading.set(false); fixture.detectChanges(); await fixture.whenStable();
    expect(app.frame()).toBeTruthy();
    expect(router.parseUrl(router.url).queryParams['path']).toBe('/contrats?type=CLIENT');
  });
  it('retire le module lors du retour navigateur vers le tableau de bord', async () => {
    const fixture = TestBed.createComponent(App); const router = TestBed.inject(Router);
    fixture.componentInstance.open({ module: 'contrats', label: 'Clients', path: '/contrats?type=CLIENT' });
    await fixture.whenStable(); expect(fixture.componentInstance.frame()).toBeTruthy();
    await router.navigateByUrl('/dashboard'); await fixture.whenStable();
    expect(fixture.componentInstance.frame()).toBeNull();
  });
  it('restaure une URL directe puis recharge le module au changement de societe sans perdre son filtre', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/module'], { queryParams: { module: 'contrats', path: '/contrats?type=CLIENT' } });
    const fixture = TestBed.createComponent(App); const app = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable();
    const frame = app.frame(); expect(frame).toBeTruthy();
    value.update(v => ({ ...v, societeInterneId: 4 })); fixture.detectChanges();
    await vi.waitFor(() => { expect(app.frame()).toBeTruthy(); expect(app.frame()).not.toBe(frame); });
    expect(router.parseUrl(router.url).queryParams['path']).toBe('/contrats?type=CLIENT');
  });
  it('garde le menu Mobile PWA invisible tant que le module est désactivé', async () => {
    const fixture=TestBed.createComponent(App);fixture.detectChanges();await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Mobile PWA');
  });
  it('ouvre Mobile PWA dans le même iframe depuis le menu et le tableau de bord', async () => {
    const fixture=TestBed.createComponent(App); TestBed.inject(PwaIntegrationService).enabled.set(true);
    fixture.detectChanges();await fixture.whenStable();
    const buttons=Array.from(fixture.nativeElement.querySelectorAll('button')).filter((b:any)=>b.textContent.trim()==='Mobile PWA') as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    for(const selector of ['nav','.panels']){
      const button=Array.from(fixture.nativeElement.querySelectorAll(selector+' button')).find((b:any)=>b.textContent.trim()==='Mobile PWA') as HTMLButtonElement;
      button.click();await fixture.whenStable();
      expect(TestBed.inject(Router).url).toContain('module=pwa');
      expect(fixture.nativeElement.querySelector('iframe').getAttribute('src')).toBe('/pwa/notes-frais');
      fixture.componentInstance.dashboard();await fixture.whenStable();}
  });
  it('restaure une URL PWA directe après chargement de sa disponibilité', async () => {
    const pwa=TestBed.inject(PwaIntegrationService);pwa.loading.set(true);
    const router=TestBed.inject(Router);await router.navigate(['/module'],{queryParams:{module:'pwa',path:'/profil'}});
    const fixture=TestBed.createComponent(App);fixture.detectChanges();expect(fixture.componentInstance.frame()).toBeNull();
    pwa.enabled.set(true);pwa.loading.set(false);fixture.detectChanges();await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('iframe').getAttribute('src')).toBe('/pwa/profil');
  });
  it('refuse une URL PWA directe sans droits ou quand le module est fermé', async () => {
    const fixture=TestBed.createComponent(App);const app=fixture.componentInstance;
    app.open({module:'pwa',path:'/notes-frais',label:'Mobile PWA'});await fixture.whenStable();expect(app.frame()).toBeNull();
    const role=vi.spyOn(context,'hasRole').mockReturnValue(false);TestBed.inject(PwaIntegrationService).enabled.set(true);
    app.open({module:'pwa',path:'/notes-frais',label:'Mobile PWA'});await fixture.whenStable();expect(app.frame()).toBeNull();role.mockRestore();
  });
});
