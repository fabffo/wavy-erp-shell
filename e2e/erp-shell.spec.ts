import { expect, Page, test } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Adresse email').fill(process.env['WAVY_E2E_EMAIL'] ?? 'demo@wavy.local');
  await page.getByLabel('Mot de passe').fill(process.env['WAVY_E2E_PASSWORD'] ?? 'demo');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
}

test.describe('Wavy ERP Shell', () => {
  test('ouvre une session ERP et partage le contexte utilisateur', async ({ page }) => {
    await login(page);

    await expect(page.getByText(process.env['WAVY_E2E_EMAIL'] ?? 'demo@wavy.local')).toBeVisible();
    await expect(page.getByText('Société courante')).toBeVisible();

    const storedContext = await page.evaluate(() => ({
      legacySession: sessionStorage.getItem('wavy.erp.session.v1'),
      context: JSON.parse(localStorage.getItem('wavy.erp.context.v1') ?? 'null'),
      factures: JSON.parse(localStorage.getItem('wavy.factures.profil') ?? 'null'),
    }));
    expect(storedContext.legacySession).toBeNull();
    expect(storedContext.context.utilisateurId).toBeGreaterThan(0);
    expect(storedContext.context.tenantId).toBeGreaterThan(0);
    expect(storedContext.context.societeInterneId).toBeGreaterThan(0);
    expect(storedContext.factures.utilisateurId).toBe(storedContext.context.utilisateurId);
  });

  test('ouvre tous les modules avec une seule session', async ({ page }) => {
    await login(page);
    for (const label of ['Tous les tiers', 'Tous les contrats', 'Factures d’achat', 'Opérations bancaires']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.frameLocator('iframe').getByText('Se connecter', { exact: true })).toHaveCount(0);
    }
  });

  test('le logout global invalide aussi les modules', async ({ page }) => {
    await login(page);
    await page.locator('button.profile').click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/connexion/);
    const response = await page.request.get('/api/auth/session');
    expect(response.status()).toBe(401);
  });

  test('navigue entre Factures et Tiers sans seconde connexion', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: 'Factures de vente', exact: true }).click();
    await expect(page).toHaveURL(/\/module\?module=factures/);
    await expect(page.locator('iframe[title="Module Wavy"]')).toHaveAttribute('src', /\/modules\/factures\/factures\/ventes/);
    await expect(page.frameLocator('iframe').locator('body')).toBeVisible();
    await expect(page.frameLocator('iframe').getByText('Se connecter', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Tous les tiers', exact: true }).click();
    await expect(page).toHaveURL(/\/module\?module=tiers/);
    await expect(page.locator('iframe[title="Module Wavy"]')).toHaveAttribute('src', /\/modules\/tiers\/tiers/);
    await expect(page.frameLocator('iframe').locator('body')).toBeVisible();
    await expect(page.frameLocator('iframe').getByText('Se connecter', { exact: true })).toHaveCount(0);
  });

  test('conserve la route métier dans l’URL et le fil d’Ariane', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: 'Opérations bancaires', exact: true }).click();
    await expect(page).toHaveURL(/module=tr%C3%A9sorerie|module=tresorerie/);
    await expect(page).toHaveURL(/path=%2Ftresorerie%3Fvue%3Doperations/);
    await expect(page.locator('.crumb')).toContainText('Trésorerie');
    await expect(page.locator('iframe[title="Module Wavy"]')).toHaveAttribute('src', /\/modules\/tresorerie\/tresorerie\?vue=operations/);
  });
});
