import { test, expect } from '@playwright/test';

const APP_URL = 'http://localhost:5173/fb-politika-archivum/';

// The real app loads its SQLite database in a Web Worker from a remote CDN. These
// tests only exercise the mobile UI logic, so we stub the Worker: no network/DB, but
// it emits a minimal 'ready' so the app runs its real onReady path (enables the
// controls, wires the author combobox, sets the date bounds).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      set onmessage(fn) {
        this._fn = fn;
        setTimeout(
          () =>
            fn({
              data: {
                type: 'ready',
                authors: [
                  { authorId: 1, authorname: 'Teszt Szerzo', post_count: 10 },
                  { authorId: 2, authorname: 'Masik Szerzo', post_count: 5 }
                ],
                meta: { min_time: 1199145600, max_time: 1750000000 }
              }
            }),
          0
        );
      }
      get onmessage() {
        return this._fn;
      }
      set onerror(_) {}
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
  // onReady (triggered by the stub's 'ready') enables the controls and wires the
  // combobox; waiting for the search box to enable means setup is complete.
  await expect(page.locator('#search')).toBeEnabled();
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

test('auto-hides on scroll even while a filter field is focused', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  await makeScrollable(page);

  await page.locator('#filters-toggle').click(); // expand so the date field is shown
  await page.locator('#date-from').focus();
  await expect(page.locator('#date-from')).toBeFocused();
  // Selecting a filter leaves its field focused; after the brief focus grace window,
  // scrolling down must still collapse the pane so the results get the full screen.
  await page.waitForTimeout(500);
  await scrollWindow(page, 800);
  await expect(controls).toHaveClass(/controls--hidden/);
});

test('tapping a date field requests the native picker on a touch pointer', async ({ page }) => {
  await openDatabaseTab(page);
  await page.locator('#filters-toggle').click(); // expand so the date fields show
  // Sanity: the mobile profile reports a coarse pointer (what gates the showPicker call).
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  // Spy on the native showPicker for both date inputs.
  await page.evaluate(() => {
    window.__pickCalls = [];
    for (const id of ['date-from', 'date-to']) {
      document.getElementById(id).showPicker = function () {
        window.__pickCalls.push(id);
      };
    }
  });
  await page.locator('#date-from').click();
  expect(await page.evaluate(() => window.__pickCalls)).toContain('date-from');
});

test('scrolling down closes an open author dropdown', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  const listbox = page.locator('#author-listbox');
  await makeScrollable(page);

  await page.locator('#filters-toggle').click(); // expand filters
  await page.locator('#author-input').click(); // open the author dropdown
  await expect(listbox).toBeVisible();

  // After the open-grace window, a deliberate page scroll dismisses the popup.
  await page.waitForTimeout(500);
  await scrollWindow(page, 800);
  await expect(listbox).toBeHidden();
  await expect(controls).toHaveClass(/controls--hidden/);
});

test('a selected date can be cleared via its clear button on touch', async ({ page }) => {
  await openDatabaseTab(page);
  await page.locator('#filters-toggle').click(); // expand filters
  const dateFrom = page.locator('#date-from');
  const clear = page.locator('#date-from-clear');

  await expect(clear).toBeHidden(); // no value yet
  await dateFrom.fill('2020-05-01');
  await expect(dateFrom).toHaveValue('2020-05-01');
  await expect(clear).toBeVisible(); // appears on a coarse pointer once a value is set
  // The input must stay wide even with the clear button present, so the native date
  // display can't clip the year (regression guard).
  expect((await dateFrom.boundingBox()).width).toBeGreaterThan(200);

  await clear.click();
  await expect(dateFrom).toHaveValue('');
  await expect(clear).toBeHidden();
});

test('an expanded pane returns collapsed after scrolling away and back', async ({ page }) => {
  await openDatabaseTab(page);
  const controls = page.locator('#controls');
  await makeScrollable(page);

  await page.locator('#filters-toggle').click(); // expand
  await expect(controls).not.toHaveClass(/controls--collapsed/);

  await page.waitForTimeout(500); // let the toggle grace lapse
  await scrollWindow(page, 800);
  await expect(controls).toHaveClass(/controls--hidden/);

  await page.waitForTimeout(300); // let the collapse grace lapse
  await scrollWindow(page, 200);
  await expect(controls).not.toHaveClass(/controls--hidden/); // revealed
  await expect(controls).toHaveClass(/controls--collapsed/); // ...and collapsed again
});
