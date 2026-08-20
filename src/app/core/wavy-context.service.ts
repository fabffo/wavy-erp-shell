import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, finalize, map, of, switchMap, tap, throwError } from 'rxjs';

export interface WavyCompany { id: number; nom: string; }
export interface WavyContext {
  utilisateurId: number | null; email: string; nom: string;
  tenantId: number | null; tenantNom: string;
  societeInterneId: number | null; societeNom: string;
  roles: string[]; permissions: string[]; readOnly: boolean;
}
interface AuthProfile {
  utilisateurId?: number; email?: string; nom?: string; prenom?: string; roles?: string[]; permissions?: string[];
  tenantId?: number; tenantNom?: string; societeCouranteId?: number; societeCouranteNom?: string;
  societesAutorisees?: Array<{ id?: number; nom?: string }>;
}
interface LoginResponse { email: string; authentifie: boolean; dateExpiration?: string; }
const EMPTY_CONTEXT: WavyContext = {
  utilisateurId: null, email: '', nom: 'Utilisateur', tenantId: null, tenantNom: '',
  societeInterneId: null, societeNom: 'Société courante', roles: [], permissions: [], readOnly: false,
};

class ErpAccessError extends Error {}

@Injectable({ providedIn: 'root' })
export class WavyContextService {
  private readonly refreshIntervalMs = 5 * 60 * 1000;
  private readonly http = inject(HttpClient);
  private readonly contextKey = 'wavy.erp.context.v1';
  readonly value = signal<WavyContext>(this.restoreContext());
  readonly companies = signal<WavyCompany[]>([]);
  readonly loading = signal(true);
  readonly sessionValidated = signal(false);
  readonly authError = signal('');
  readonly authenticated = computed(() => {
    const context = this.value();
    return this.sessionValidated() && context.utilisateurId !== null && context.tenantId !== null && context.societeInterneId !== null;
  });

  hasRole(role: string): boolean {
    const roles = this.value().roles;
    return roles.includes('ADMIN_PLATEFORME') || roles.includes('ADMIN_TENANT') || roles.includes(role);
  }

  canAccessModule(module: string): boolean {
    const roles = this.value().roles.map((role) => role.replace(/^ROLE_/, '').toUpperCase());
    if (roles.includes('ADMIN_PLATEFORME') || roles.includes('ADMIN_TENANT')) return true;
    if (module === 'socle') return false;
    const known = roles.some((role) => ['GESTIONNAIRE', 'COMPTABLE', 'LECTURE', 'LECTURE_SEULE'].includes(role));
    if (!known) return true;
    if (roles.includes('COMPTABLE')) return ['factures', 'tresorerie'].includes(module);
    return ['tiers', 'contrats', 'factures', 'tresorerie'].includes(module);
  }

  bootstrap(): void {
    this.getSession().pipe(
      switchMap(() => this.loadProfile()),
      finalize(() => this.loading.set(false)),
    ).subscribe({ error: () => this.clearSession() });
    window.setInterval(() => {
      if (!document.hidden && this.authenticated()) {
        this.refreshSession().subscribe({ error: () => this.clearSession() });
      }
    }, this.refreshIntervalMs);
  }

  login(email: string, password: string) {
    this.loading.set(true); this.authError.set('');
    return this.http.post<LoginResponse>('/api/auth/session', { email, motDePasse: password }, { withCredentials: true }).pipe(
      switchMap(() => this.loadProfile()),
      catchError((error) => {
        this.clearSession();
        this.authError.set(error instanceof ErpAccessError
          ? error.message
          : error.status === 401 ? 'Email ou mot de passe incorrect.' : 'Connexion au serveur impossible.');
        return throwError(() => error);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  logout(): void {
    this.http.delete('/api/auth/session', { withCredentials: true }).pipe(catchError(() => of(null))).subscribe();
    this.clearSession(); this.broadcast('WAVY_SESSION_CLOSED');
  }

  getSession() { return this.http.get<LoginResponse>('/api/auth/session', { withCredentials: true }); }
  refreshSession() { return this.getSession(); }
  isAuthenticated(): boolean { return this.authenticated(); }

  update(patch: Partial<WavyContext>, event = 'WAVY_CONTEXT_CHANGED'): void {
    this.value.update((current) => ({ ...current, ...patch }));
    this.persistContext(); this.syncEmbeddedModuleContexts(); this.broadcast(event);
  }

  selectCompany(id: number): void {
    const company = this.companies().find((item) => item.id === id);
    if (!company || id === this.value().societeInterneId) return;
    this.http.post<AuthProfile>('/api/auth/session/societe', { societeInterneId: id }, { withCredentials: true })
      .subscribe({
        next: (profile) => {
          const normalized = this.normalizeProfile(profile);
          this.companies.set(normalized.companies);
          this.value.set(normalized.context);
          this.persistContext(); this.syncEmbeddedModuleContexts(); this.broadcast('SOCIETE_CHANGED');
        },
        error: () => this.authError.set('Impossible de changer de société.'),
      });
  }

  receive(event: MessageEvent): void {
    if (event.origin !== location.origin || !event.data?.type) return;
    if (event.data.type === 'WAVY_CONTEXT_REQUEST') this.broadcast('WAVY_CONTEXT_CHANGED');
    if (event.data.type === 'WAVY_NAVIGATE' && typeof event.data.path === 'string')
      window.dispatchEvent(new CustomEvent('wavy:navigate', { detail: event.data }));
    if (event.data.type === 'WAVY_ROUTE_CHANGED' && typeof event.data.path === 'string')
      window.dispatchEvent(new CustomEvent('wavy:route-changed', { detail: event.data }));
  }

  broadcast(type: string): void {
    document.querySelectorAll('iframe').forEach((frame) =>
      frame.contentWindow?.postMessage({ type, context: this.value() }, location.origin));
  }

  private loadProfile() {
    return this.http.get<AuthProfile>('/api/profil').pipe(
      map((profile) => this.normalizeProfile(profile)),
      tap(({ context, companies }) => {
        this.companies.set(companies); this.value.set(context); this.persistContext();
        this.sessionValidated.set(true);
        this.syncEmbeddedModuleContexts();
      }),
    );
  }

  private normalizeProfile(profile: AuthProfile): { context: WavyContext; companies: WavyCompany[] } {
    const companies = (profile.societesAutorisees ?? [])
      .filter((company): company is { id: number; nom?: string } => Number.isInteger(company.id) && (company.id ?? 0) > 0)
      .map((company) => ({ id: company.id, nom: company.nom || `Société ${company.id}` }));
    if (!Number.isInteger(profile.utilisateurId) || (profile.utilisateurId ?? 0) <= 0)
      throw new ErpAccessError('Votre compte utilisateur est incomplet. Contactez un administrateur du tenant.');
    if (!Number.isInteger(profile.tenantId) || (profile.tenantId ?? 0) <= 0)
      throw new ErpAccessError('Votre compte doit être rattaché à un tenant pour accéder à Wavy ERP.');
    if (!companies.length)
      throw new ErpAccessError('Aucune société ne vous est attribuée. Contactez un administrateur du tenant.');
    const stored = this.value();
    const allowedStoredCompany = companies.find((company) => company.id === stored.societeInterneId);
    const profileCompany = companies.find((company) => company.id === profile.societeCouranteId);
    const companyId = profileCompany?.id ?? allowedStoredCompany?.id ?? companies[0].id;
    const company = companies.find((item) => item.id === companyId);
    const email = profile.email ?? stored.email;
    const fullName = [profile.prenom, profile.nom].filter((part) => part?.trim()).join(' ');
    return { companies, context: {
      utilisateurId: profile.utilisateurId!, email,
      nom: fullName || email.split('@')[0] || 'Utilisateur',
      tenantId: profile.tenantId!, tenantNom: profile.tenantNom ?? stored.tenantNom,
      societeInterneId: companyId, societeNom: company?.nom ?? profile.societeCouranteNom ?? `Société ${companyId}`,
      roles: Array.isArray(profile.roles) ? profile.roles.map((role) => role.replace(/^ROLE_/, '')) : [],
      permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
      readOnly: (profile.roles ?? []).some((role) => ['LECTURE', 'LECTURE_SEULE', 'ROLE_LECTURE', 'ROLE_LECTURE_SEULE'].includes(role)),
    }};
  }

  /**
   * Pont temporaire pour les fronts intégrés qui restaurent encore leur profil
   * depuis leur propre clé. Ils sont servis par le Shell en même origine : le
   * profil partagé évite un écran de reconnexion pendant leur migration vers le
   * bus WavyContext.
   */
  private syncEmbeddedModuleContexts(): void {
    const context = this.value();
    if (!context.utilisateurId || !context.tenantId || !context.societeInterneId) return;
    const societesAutorisees = this.companies().map((company) => ({ id: company.id, nom: company.nom }));
    const profile = {
      email: context.email,
      nom: context.nom,
      prenom: '',
      roles: context.roles,
      tenantId: context.tenantId,
      tenantNom: context.tenantNom,
      utilisateurId: context.utilisateurId,
      societeCouranteId: context.societeInterneId,
      societeCouranteNom: context.societeNom,
      societesAutorisees,
      readOnly: context.readOnly,
    };
    try {
      localStorage.setItem('wavy.factures.profil', JSON.stringify(profile));
    } catch { /* Les modules peuvent toujours restaurer la session serveur. */ }
  }

  private clearSession(): void {
    this.value.set({ ...EMPTY_CONTEXT }); this.companies.set([]);
    this.sessionValidated.set(false);
    try {
      localStorage.removeItem(this.contextKey); localStorage.removeItem('wavy.factures.profil');
    } catch { /* L'état mémoire reste la source de vérité. */ }
  }
  private persistContext(): void {
    try { localStorage.setItem(this.contextKey, JSON.stringify(this.value())); } catch { /* Contexte conservé en mémoire. */ }
  }
  private restoreContext(): WavyContext {
    try { return { ...EMPTY_CONTEXT, ...JSON.parse(localStorage.getItem(this.contextKey) ?? '{}') }; }
    catch { return { ...EMPTY_CONTEXT }; }
  }
}
