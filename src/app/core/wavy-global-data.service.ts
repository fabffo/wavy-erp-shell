import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

export interface GlobalSearchResult {
  type: 'Tiers' | 'Contrat' | 'Facture de vente' | "Facture d’achat" | 'Opération bancaire';
  label: string;
  detail?: string;
  module: string;
  path: string;
}

export interface GlobalNotification {
  label: string;
  count: number;
  module: string;
  path: string;
  level: 'warning' | 'danger' | 'info';
}

export interface ErpDashboard {
  chiffreAffaires: number | null; margeNette: number | null; tresorerie: number | null;
  aEncaisser: number | null; aPayer: number | null; rapprochementsAValider: number | null;
  contratsActifs: number | null; alertes: number;
}

type Item = Record<string, unknown>;
type Page<T> = { content?: T[]; totalElements?: number };

@Injectable({ providedIn: 'root' })
export class WavyGlobalDataService {
  private readonly http = inject(HttpClient);

  search(query: string) {
    const q = query.trim();
    if (q.length < 2) return of([] as GlobalSearchResult[]);
    return forkJoin({
      tiers: this.safe<Item[]>(this.http.get<Item[]>('/api/tiers/search', { params: { query: q } }), []),
      contrats: this.safe<Item[]>(this.http.get<Item[]>('/api/contrats'), []),
      ventes: this.safe<Item[]>(this.http.get<Item[]>('/api/factures/ventes', { params: { recherche: q } }), []),
      achats: this.safe<Item[]>(this.http.get<Item[]>('/api/factures/achats', { params: { recherche: q } }), []),
      operations: this.safe<Page<Item>>(this.http.get<Page<Item>>('/api/tresorerie/operations-bancaires', { params: { libelle: q, page: 0, size: 8 } }), {}),
    }).pipe(map(({ tiers, contrats, ventes, achats, operations }) => {
      const needle = q.toLocaleLowerCase('fr');
      const contratMatches = contrats.filter((item) => this.contains(item, needle)).slice(0, 8);
      return [
        ...tiers.slice(0, 8).map((item) => this.result('Tiers', item, 'tiers', `/tiers/${item['id']}`, ['raisonSociale', 'nomComplet', 'nom', 'displayName'], ['siren', 'email'])),
        ...contratMatches.map((item) => this.result('Contrat', item, 'contrats', `/contrats/${item['id']}`, ['numeroContrat', 'numero', 'displayName', 'libelle'], ['objet', 'statut'])),
        ...ventes.slice(0, 8).map((item) => this.result('Facture de vente', item, 'factures', `/factures/ventes/${item['id']}`, ['numeroFacture', 'numero', 'libelle'], ['libelle', 'statutFacture'])),
        ...achats.slice(0, 8).map((item) => this.result("Facture d’achat", item, 'factures', `/factures/achats/${item['id']}`, ['numeroFactureFournisseur', 'numeroInterneAchat', 'libelle'], ['fournisseurNom', 'statutFactureAchat'])),
        ...(operations.content ?? []).slice(0, 8).map((item) => this.result('Opération bancaire', item, 'tresorerie', `/tresorerie?vue=operations&operationId=${item['id']}`, ['libelle', 'referenceBancaire'], ['tiersReconnu', 'montant'])),
      ].slice(0, 25);
    }));
  }

  notifications() {
    return forkJoin({
      kpis: this.safe<Item>(this.http.get<Item>('/api/tresorerie/factures-echeances/kpis'), {}),
      operations: this.safe<Page<Item>>(this.http.get<Page<Item>>('/api/tresorerie/operations-bancaires', {
        params: new HttpParams().set('statutRapprochement', 'NON_RAPPROCHEE').set('page', 0).set('size', 1),
      }), {}),
    }).pipe(map(({ kpis, operations }) => {
      const values: GlobalNotification[] = [];
      const overdue = Number(kpis['nombreFacturesEnRetard'] ?? 0);
      const upcoming = Number(kpis['echeancesA7Jours'] ?? 0);
      const unmatched = Number(operations.totalElements ?? 0);
      if (overdue) values.push({ label: 'Factures en retard', count: overdue, module: 'tresorerie', path: '/tresorerie?vue=factures-echeances&vueEcheances=EN_RETARD', level: 'danger' });
      if (upcoming) values.push({ label: 'Échéances dans les 7 jours', count: upcoming, module: 'tresorerie', path: '/tresorerie?vue=factures-echeances', level: 'warning' });
      if (unmatched) values.push({ label: 'Opérations non rapprochées', count: unmatched, module: 'tresorerie', path: '/tresorerie?vue=operations&statutRapprochement=NON_RAPPROCHEE', level: 'warning' });
      return values;
    }));
  }

  dashboard(alertes = 0) {
    const now = new Date();
    const dateDebut = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const dateFin = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return forkJoin({
      finance: this.safe<Item>(this.http.get<Item>('/api/dashboard-financier', { params: { dateDebut, dateFin } }), {}),
      treasury: this.safe<Item>(this.http.get<Item>('/api/tresorerie/dashboard'), {}),
      deadlines: this.safe<Item>(this.http.get<Item>('/api/tresorerie/factures-echeances/kpis'), {}),
      contracts: this.safe<Item[]>(this.http.get<Item[]>('/api/contrats'), []),
    }).pipe(map(({ finance, treasury, deadlines, contracts }): ErpDashboard => {
      const kpis = (finance['kpis'] ?? {}) as Item;
      const activeContracts = contracts.filter((contract) => !['TERMINE', 'RESILIE', 'ANNULE', 'CLOTURE'].includes(String(contract['statut'] ?? contract['statutContrat'] ?? '').toUpperCase())).length;
      return {
        chiffreAffaires: this.number(kpis['chiffreAffairesHt']), margeNette: this.number(kpis['margeNette']),
        tresorerie: this.number(treasury['soldeTotal']), aEncaisser: this.number(deadlines['aEncaisser']),
        aPayer: this.number(deadlines['aPayer']), rapprochementsAValider: this.number(treasury['operationsARapprocher']),
        contratsActifs: activeContracts,
        alertes: alertes || Number(deadlines['nombreFacturesEnRetard'] ?? 0) + Number(treasury['operationsARapprocher'] ?? 0),
      };
    }));
  }

  private safe<T>(source: Observable<T>, fallback: T): Observable<T> {
    return source.pipe(catchError(() => of(fallback)));
  }

  private contains(item: Item, needle: string): boolean {
    return Object.values(item).some((value) => typeof value === 'string' && value.toLocaleLowerCase('fr').includes(needle));
  }

  private result(type: GlobalSearchResult['type'], item: Item, module: string, path: string, labels: string[], details: string[]): GlobalSearchResult {
    const pick = (keys: string[]) => keys.map((key) => item[key]).find((value) => value !== null && value !== undefined && String(value).trim());
    return { type, label: String(pick(labels) ?? `${type} ${item['id'] ?? ''}`), detail: String(pick(details) ?? ''), module, path };
  }

  private number(value: unknown): number | null {
    const result = Number(value); return value !== null && value !== undefined && Number.isFinite(result) ? result : null;
  }
}
