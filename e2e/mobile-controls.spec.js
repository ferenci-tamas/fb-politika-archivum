import { test, expect } from '@playwright/test';

const APP_URL = 'http://localhost:5173/fb-politika-archivum/';

// The real app loads its SQLite database in a Web Worker from a remote CDN. These
// tests only exercise the mobile collapse / auto-hide UI logic, so we stub the
// Worker (no network, fully deterministic) and then do the two things the app's
// onReady would otherwise do once the database finished loading: hide the loading
// overlay and enable the controls.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    };
  });
  // Block external calls (CDN database, analytics) so the run is offline and fast.
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
});

async function openDatabaseTab(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#landing')).not.toBeEmpty(); // main.js has executed
  await page.locator('#tab-adatbazis').click();
  await expect(page.locator('#panel-adatbazis')).toBeVisible();
  await page.evaluate(() => {
    document.getElementById('app-loading').hidden = true;
    document.querySelectorAll('#controls [disabled]').forEach((el) => {
      el.disabled = false;
    });
  });
}

// The stubbed DB renders no rows, so force the page tall enough to scroll.
async function makeScrollable(page) {
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.getElementById('panel-adatbazis').appendChild(spacer);
  });
}

async function scrollWindow(page, y) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(150); // let the rAF-throttled scroll handler settle
}

test('is collapsed on mobile and the Szurok toggle opens/closes the filters', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  const toggle = page.locator('#filters-toggle');
  const filterRow = page.locator('#filter-row');

  await expect(toggle).toBeVisible();
  await expect(controls).toHaveClass(/controls--collapsed/);
  await expect(filterRow).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(controls).not.toHaveClass(/controls--collapsed/);
  await expect(filterRow).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(filterRow).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('auto-hides on scroll down and returns on scroll up', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  await makeScrollable(page);

  await expect(controls).not.toHaveClass(/controls--hidden/);
  await scrollWindow(page, 800);
  await expect(controls).toHaveClass(/controls--hidden/);
  await scrollWindow(page, 300);
  await expect(controls).not.toHaveClass(/controls--hidden/);
});

test('opening Szurok while scrolled keeps the pane visible (regression)', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  const toggle = page.locator('#filters-toggle');
  await makeScrollable(page);

  await scrollWindow(page, 800);
  await expect(controls).toHaveClass(/controls--hidden/);
  await scrollWindow(page, 400);
  await expect(controls).not.toHaveClass(/controls--hidden/);

  await toggle.click();
  // Drop focus so this isolates the post-toggle grace window from the focus guard
  // (mirrors mobile browsers that don't focus a button on tap).
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  // The layout-shift scroll that used to re-hide the pane right after opening it:
  await scrollWindow(page, 470);
  await expect(controls).not.toHaveClass(/controls--collapsed/);
  await expect(controls).not.toHaveClass(/controls--hidden/);
});

test('focusing a date field prevents auto-hide (regression)', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  await makeScrollable(page);

  await page.locator('#filters-toggle').click(); // expand so the date field is shown
  await page.locator('#date-from').focus();
  await expect(page.locator('#date-from')).toBeFocused();
  // Let the focusin grace window lapse so this isolates the active-element guard.
  await page.waitForTimeout(500);
  await scrollWindow(page, 800);
  await expect(controls).not.toHaveClass(/controls--hidden/);
  await expect(page.locator('#date-from')).toBeFocused();
});
