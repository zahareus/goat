import { test, expect } from '@playwright/test';
export { test, expect };

/**
 * Navigate to a GOAT page with ?notour param to skip Driver.js onboarding.
 */
export async function gotoWithoutTour(page, url) {
  // Add ?notour to the URL to skip Driver.js tour
  const urlObj = new URL(url);
  urlObj.searchParams.set('notour', '1');
  await page.goto(urlObj.toString());
  await page.waitForLoadState('domcontentloaded');
}
