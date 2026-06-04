import { test, expect, type Page } from '@playwright/test';

async function loginAs(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name=password]', process.env.DASHBOARD_PASSWORD ?? 'test-password-e2e');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
}

test('dashboard renders stats section', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Total señales')).toBeVisible();
  await expect(page.locator('text=Oportunidades')).toBeVisible();
});

test('dashboard renders sectors grid', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Sectores Emergentes')).toBeVisible();
});

test('dashboard renders opportunities table', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Oportunidades').first()).toBeVisible();
  await expect(page.locator('table')).toBeVisible();
});

test('dashboard renders leads table', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Leads')).toBeVisible();
});

test('settings panel toggles open and closed', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Configuración')).toBeVisible();
  await page.click('button:has-text("Mostrar")');
  await expect(page.locator('text=Scoring')).toBeVisible();
  await page.click('button:has-text("Ocultar")');
  await expect(page.locator('text=Scoring')).not.toBeVisible();
});

test('discover button triggers discovery flow', async ({ page }) => {
  await loginAs(page);
  await page.click('button:has-text("Descubrir ahora")');
  // Button shows loading state
  await expect(page.locator('button:has-text("Explorando...")')).toBeVisible();
  // Eventually shows result (may take a few seconds with a live worker)
  await expect(page.locator('button').filter({ hasText: /sectores|Descubrir/ })).toBeVisible({ timeout: 15_000 });
});
