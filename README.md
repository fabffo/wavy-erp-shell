# Wavy ERP Shell

Point d'entrée unique des modules Wavy. Le shell Angular porte la connexion, le contexte utilisateur/tenant/société, le menu global et l'intégration progressive des fronts métier.

## Lancement

Depuis ce dépôt :

```bash
npm install
npm start
```

Le mode Docker est orchestré depuis `wavy-devops` :

```bash
docker compose --env-file .env.local -f docker-compose.local.yml up -d --build wavy-erp-shell-local
```

URL locale Docker : `http://localhost:14207` (modifiable avec `WAVY_ERP_SHELL_HOST_PORT`).

URL recette Docker : `http://localhost:24207`.

## Intégration

- Toutes les APIs passent par `/api/**`, routé vers `wavy-gateway`.
- Les fronts sont servis sous `/modules/{socle,tiers,contrats,factures,tresorerie}/**`.
- La session Basic reste dans `sessionStorage`, jamais dans `localStorage`.
- Le contexte non sensible est restauré depuis `wavy.erp.context.v1`.
- Les iframes reçoivent les événements `WAVY_CONTEXT_CHANGED`, `SOCIETE_CHANGED` et `WAVY_SESSION_CLOSED` par `postMessage` same-origin.
- Un module peut demander le contexte avec `WAVY_CONTEXT_REQUEST` ou demander une navigation avec `WAVY_NAVIGATE`.

## Vérifications

```bash
npm run build
npm test -- --watch=false
```
