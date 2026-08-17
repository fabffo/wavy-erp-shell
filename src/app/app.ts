import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { WavyContextService } from './core/wavy-context.service';
import { ErpDashboard, GlobalNotification, GlobalSearchResult, WavyGlobalDataService } from './core/wavy-global-data.service';

type Entry = { label: string; module: string; path: string; roles?: string[] };
type Group = { label: string; icon: string; module: string; entries: Entry[]; roles?: string[] };
type Breadcrumb = { label: string };

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.html', styleUrl: './app.scss' })
export class App {
  readonly context = inject(WavyContextService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly globalData = inject(WavyGlobalDataService);
  readonly menuOpen = signal(true); readonly notificationsOpen = signal(false); readonly profileOpen = signal(false);
  readonly query = signal(''); readonly frame = signal<SafeResourceUrl | null>(null); readonly currentLabel = signal('Tableau de bord');
  readonly breadcrumbs = signal<Breadcrumb[]>([{ label: 'Tableau de bord' }]);
  readonly searchResults = signal<GlobalSearchResult[]>([]); readonly searchLoading = signal(false);
  readonly notifications = signal<GlobalNotification[]>([]);
  readonly accessDenied = signal('');
  readonly dashboardData = signal<ErpDashboard | null>(null); readonly dashboardLoading = signal(false);
  private currentModule = ''; private currentPath = '';
  private searchTimer?: ReturnType<typeof setTimeout>; private notificationContext = '';
  email = ''; password = '';

  readonly groups: Group[] = [
    { label: 'Tiers', icon: '◎', module: 'tiers', entries: [['Tous les tiers', '/tiers'], ['Clients', '/tiers/role/CLIENT'], ['Fournisseurs', '/tiers/role/FOURNISSEUR_GENERAL'], ['Salariés', '/tiers/role/SALARIE'], ['Contacts', '/contacts']].map(([label, path]) => ({ label, module: 'tiers', path })) },
    { label: 'Contrats', icon: '▣', module: 'contrats', entries: [['Tous les contrats', '/contrats'], ['Contrats clients', '/contrats?type=CLIENT'], ['Contrats fournisseurs', '/contrats?type=FOURNISSEUR'], ['Références contractuelles', '/references']].map(([label, path]) => ({ label, module: 'contrats', path })) },
    { label: 'Factures', icon: '▤', module: 'factures', entries: [['Dashboard financier', '/dashboard-financier'], ['Factures de vente', '/factures/ventes'], ["Factures d’achat", '/factures/achats'], ['Salaires', '/salaires'], ['Notes de frais', '/notes-frais'], ['Extraction IA', '/factures/achats?mode=extraction']].map(([label, path]) => ({ label, module: 'factures', path })) },
    { label: 'Trésorerie', icon: '◫', module: 'tresorerie', entries: [['Tableau de bord', 'dashboard'], ['Comptes bancaires', 'comptes'], ['Import relevés', 'import'], ['Opérations bancaires', 'operations'], ['Rapprochement bancaire', 'rapprochement'], ['Pièces de rapprochement', 'pieces-rapprochement'], ['Factures échéances', 'factures-echeances'], ['Balance âgée', 'balance-agee'], ['Prévisionnel', 'previsionnel']].map(([label, view]) => ({ label, module: 'tresorerie', path: `/tresorerie?vue=${view}` })) },
    { label: 'Administration', icon: '⚙', module: 'socle', roles: ['ADMIN_TENANT', 'ADMIN_PLATEFORME'], entries: [['Tenant', '/tenants'], ['Sociétés', '/contexte'], ['Utilisateurs', '/utilisateurs'], ['Paramètres', '/parametres'], ['Compteurs', '/compteurs']].map(([label, path]) => ({ label, module: 'socle', path })) },
  ];
  readonly visibleGroups = computed(() => this.groups.filter((group) => this.context.canAccessModule(group.module) && (!group.roles || group.roles.some((role) => this.context.hasRole(role)))));

  constructor() {
    this.context.bootstrap();
    this.route.queryParamMap.subscribe((params) => {
      const module = params.get('module'); const path = params.get('path');
      if (module && path) this.setFrame(module, path, params.get('label') ?? module);
    });
    window.addEventListener('message', (event) => this.context.receive(event));
    window.addEventListener('wavy:navigate', ((event: CustomEvent) => {
      const detail = event.detail;
      if (detail?.module && detail?.path) this.open({ label: detail.label ?? detail.module, module: detail.module, path: detail.path });
    }) as EventListener);
    window.addEventListener('wavy:route-changed', ((event: CustomEvent) => this.syncModuleRoute(event.detail)) as EventListener);
    effect(() => {
      const context = this.context.value();
      if (!this.context.loading() && !this.context.authenticated() && !this.router.url.startsWith('/connexion')) {
        void this.router.navigate(['/connexion'], { queryParams: { returnUrl: this.router.url } });
        return;
      }
      const signature = `${context.utilisateurId ?? ''}:${context.societeInterneId ?? ''}`;
      if (!this.context.authenticated() || signature === this.notificationContext) return;
      this.notificationContext = signature;
      this.globalData.notifications().subscribe((items) => this.notifications.set(items));
      this.dashboardLoading.set(true);
      this.globalData.dashboard().subscribe((data) => { this.dashboardData.set(data); this.dashboardLoading.set(false); });
    });
  }

  login(): void {
    if (!this.email.trim() || !this.password) return;
    this.context.login(this.email.trim(), this.password).subscribe({ next: () => {
      this.password = '';
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (returnUrl?.startsWith('/') && !returnUrl.startsWith('//')) void this.router.navigateByUrl(returnUrl);
      else this.dashboard();
    }});
  }
  logout(): void { this.profileOpen.set(false); this.frame.set(null); this.context.logout(); this.router.navigate(['/connexion']); }
  open(entry: Entry): void {
    this.closePopovers();
    this.context.authError.set('');
    if (!this.context.canAccessModule(entry.module)) { this.accessDenied.set(`Vous n’avez pas accès au module ${entry.label}.`); this.dashboard(); return; }
    this.accessDenied.set(''); this.router.navigate(['/module'], { queryParams: entry });
  }
  dashboard(): void { this.frame.set(null); this.currentModule = ''; this.currentPath = ''; this.currentLabel.set('Tableau de bord'); this.breadcrumbs.set([{ label: 'Tableau de bord' }]); this.router.navigate(['/dashboard']); }
  back(): void { history.back(); }
  setCompany(id: string): void { if (id) this.context.selectCompany(Number(id)); }
  onQueryChange(value: string): void {
    this.query.set(value); clearTimeout(this.searchTimer);
    if (value.trim().length < 2) { this.searchResults.set([]); this.searchLoading.set(false); return; }
    this.searchTimer = setTimeout(() => this.search(), 250);
  }
  search(): void {
    const value = this.query().trim(); if (value.length < 2) return;
    this.searchLoading.set(true);
    this.globalData.search(value).subscribe((results) => { this.searchResults.set(results); this.searchLoading.set(false); });
  }
  openSearchResult(result: GlobalSearchResult): void { this.query.set(''); this.searchResults.set([]); this.open({ label: result.label, module: result.module, path: result.path }); }
  openNotification(item: GlobalNotification): void { this.notificationsOpen.set(false); this.open({ label: item.label, module: item.module, path: item.path }); }
  money(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value); }
  closePopovers(): void { this.notificationsOpen.set(false); this.profileOpen.set(false); }
  @HostListener('document:keydown.escape') escape(): void { this.closePopovers(); }
  private setFrame(module: string, path: string, label: string): void {
    if (!this.context.canAccessModule(module)) { this.accessDenied.set(`Accès au module ${module} non autorisé.`); this.dashboard(); return; }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (module !== this.currentModule || normalizedPath !== this.currentPath) {
      this.currentModule = module; this.currentPath = normalizedPath;
      this.frame.set(this.sanitizer.bypassSecurityTrustResourceUrl(`/modules/${module}${normalizedPath}`));
    }
    this.currentLabel.set(label); this.breadcrumbs.set(this.buildBreadcrumbs(module, normalizedPath, label));
  }

  private syncModuleRoute(detail: { module?: string; path?: string; label?: string }): void {
    if (!detail.module || !detail.path || detail.module !== this.currentModule) return;
    const path = detail.path.startsWith('/') ? detail.path : `/${detail.path}`;
    this.currentPath = path;
    const label = detail.label || this.routeLabel(path);
    this.currentLabel.set(label); this.breadcrumbs.set(this.buildBreadcrumbs(detail.module, path, label));
    void this.router.navigate(['/module'], { queryParams: { module: detail.module, path, label }, replaceUrl: true });
  }

  private buildBreadcrumbs(module: string, path: string, label: string): Breadcrumb[] {
    const moduleLabels: Record<string, string> = { socle: 'Administration', tiers: 'Tiers', contrats: 'Contrats', factures: 'Factures', tresorerie: 'Trésorerie' };
    const crumbs: Breadcrumb[] = [{ label: moduleLabels[module] ?? module }];
    const routeLabel = this.routeLabel(path);
    if (routeLabel !== crumbs[0].label) crumbs.push({ label: routeLabel });
    if (label && label !== routeLabel && label !== moduleLabels[module]) crumbs.push({ label });
    return crumbs;
  }

  private routeLabel(path: string): string {
    const clean = path.split('?')[0];
    const labels: Array<[RegExp, string]> = [
      [/^\/factures\/ventes\/\d+/, 'Facture de vente'], [/^\/factures\/ventes/, 'Factures de vente'],
      [/^\/factures\/achats\/\d+/, "Facture d’achat"], [/^\/factures\/achats/, "Factures d’achat"],
      [/^\/tiers\/\d+/, 'Fiche tiers'], [/^\/tiers/, 'Tiers'], [/^\/contrats\/\d+/, 'Fiche contrat'], [/^\/contrats/, 'Contrats'],
      [/^\/salaires/, 'Salaires'], [/^\/notes-frais/, 'Notes de frais'], [/^\/dashboard-financier/, 'Dashboard financier'], [/^\/tresorerie/, 'Trésorerie'],
    ];
    return labels.find(([pattern]) => pattern.test(clean))?.[1] ?? clean.split('/').filter(Boolean).at(-1)?.replaceAll('-', ' ') ?? 'Module';
  }
}
