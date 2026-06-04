import { test, expect } from '@playwright/test';

test('redirects unauthenticated users to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('login with wrong password shows error', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=password]', 'wrong-password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('.error')).toBeVisible();
});

test('login with correct password redirects to dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=password]', process.env.DASHBOARD_PASSWORD ?? 'test-password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('.title')).toHaveText('Market Intel');
});

test('logout clears session and redirects to login', async ({ page }) => {
  // Log in first
  await page.goto('/login');
  await page.fill('input[name=password]', process.env.DASHBOARD_PASSWORD ?? 'test-password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
  // Log out
  await page.click('button:has-text("Salir")');
  await expect(page).toHaveURL(/\/login/);
  // Verify session is gone
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
