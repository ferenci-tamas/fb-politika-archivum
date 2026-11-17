import { test, expect } from '@playwright/test';

const APP_URL = 'http://localhost:5173/fb-politika-archivum/';
const TRANSCRIPT = 'Jó napot kívánok!\nEz a videó leirata, ékezetekkel: őű.';

// A stub Worker standing in for the database (as in mobile-controls.spec.js), for an
// archive with transcripts (schema_version 4). It answers every query with two
// posts — one with a transcribed video, one without — answers 'transcript' with a
// fixed text, and records what the page sent in window.__posted.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((transcript) => {
    window.__posted = [];
    window.Worker = class {
      set onmessage(fn) {
        this._fn = fn;
        setTimeout(
          () =>
            fn({
              data: {
                type: 'ready',
                authors: [{ authorId: 1, authorname: 'Teszt Szerző', post_count: 2 }],
                meta: { min_time: 1199145600, max_time: 1750000000 },
                transcriptsAvailable: true,
                videoTotalsAvailable: true
              }
            }),
          0
        );
      }
      get onmessage() {
        return this._fn;
      }
      set onerror(_) {}
      postMessage(msg) {
        window.__posted.push(msg);
        const reply = (data) => setTimeout(() => this._fn({ data }), 0);
        if (msg.type === 'query') {
          const row = { postId: 'p', authorId: 1, authorname: 'Teszt Szerző', url: 'https://www.facebook.com/x', images: [], links: [] };
          reply({
            type: 'result',
            reqId: msg.reqId,
            rows: [
              { ...row, id: 2, postId: '222', time: 1588375800, text: 'Videós poszt', video: 1 },
              { ...row, id: 1, postId: '111', time: 1588289400, text: 'Szöveges poszt', video: null }
            ],
            pagination: { hasPrev: false, hasNext: false, firstKey: null, lastKey: null },
            count: 2
          });
        } else if (msg.type === 'transcript') {
          reply({ type: 'transcript-result', reqId: msg.reqId, id: msg.id, transcript, fetchedBytes: 0 });
        }
      }
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }, TRANSCRIPT);
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
});

async function openDatabaseTab(page, hash = '#tab=adatbazis') {
  await page.goto(APP_URL + hash, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#search')).toBeEnabled();
  await expect(page.locator('#results-body tr')).toHaveCount(2);
}

const lastQuery = (page) => page.evaluate(() => window.__posted.filter((m) => m.type === 'query').at(-1).view);

test('"Keresés ebben" sets the search scope, keeps one box ticked, and is deep-linked', async ({ page }) => {
  await openDatabaseTab(page);
  await page.locator('#filters-toggle').click(); // the scope sits in the collapsible part on mobile
  const text = page.locator('#search-in-text');
  const video = page.locator('#search-in-video');
  await expect(text).toBeChecked();
  await expect(video).toBeChecked();
  expect((await lastQuery(page)).searchIn).toBe('all');

  await video.uncheck();
  await expect(text).toBeDisabled(); // the last ticked box cannot be unticked
  await expect.poll(async () => (await lastQuery(page)).searchIn).toBe('text');
  await expect(page).toHaveURL(/[#&]in=text(&|$)/);

  await video.check();
  await expect(text).toBeEnabled();
  await expect.poll(async () => (await lastQuery(page)).searchIn).toBe('all');
  await expect(page).not.toHaveURL(/[#&]in=/);

  await openDatabaseTab(page, '#tab=adatbazis&q=alma&in=video');
  await expect(page.locator('#search-in-text')).not.toBeChecked();
  await expect(page.locator('#search-in-video')).toBeChecked();
  await expect.poll(async () => (await lastQuery(page)).searchIn).toBe('video');
});

const lastMonthly = (page) => page.evaluate(() => window.__posted.filter((m) => m.type === 'monthly').at(-1));

test('narratives "Keresés ebben" defaults to the post text and adapts the ratio label', async ({ page }) => {
  await page.goto(APP_URL + '#tab=elemzes&q=alma', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await lastMonthly(page))?.searchIn).toBe('text');
  await page.locator('#analysis-toggle').click(); // the settings sit in the collapsible part on mobile
  const text = page.locator('#analysis-search-in-text');
  const video = page.locator('#analysis-search-in-video');
  const ratioLabel = page.locator('#analysis-ratio-label');
  await expect(text).toBeChecked();
  await expect(video).not.toBeChecked();
  await expect(text).toBeDisabled(); // the only ticked box cannot be unticked
  await expect(ratioLabel).toHaveText('Az összes poszt számához viszonyítva');

  await video.check();
  await expect.poll(async () => (await lastMonthly(page)).searchIn).toBe('all');
  await expect(page).toHaveURL(/[#&]in=all(&|$)/);
  await text.uncheck();
  await expect.poll(async () => (await lastMonthly(page)).searchIn).toBe('video');
  await expect(page).toHaveURL(/[#&]in=video(&|$)/);
  await expect(video).toBeDisabled();
  await expect(ratioLabel).toHaveText('A leirattal rendelkező posztok számához viszonyítva');

  await text.check();
  await video.uncheck();
  await expect.poll(async () => (await lastMonthly(page)).searchIn).toBe('text');
  await expect(page).not.toHaveURL(/[#&]in=/);
  await expect(ratioLabel).toHaveText('Az összes poszt számához viszonyítva');
});

test('narratives search scope is restored from a deep link', async ({ page }) => {
  await page.goto(APP_URL + '#tab=elemzes&q=alma&in=video', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await lastMonthly(page))?.searchIn).toBe('video');
  await expect(page.locator('#analysis-search-in-text')).not.toBeChecked();
  await expect(page.locator('#analysis-search-in-video')).toBeChecked();
});

test('"Leirat" opens the transcript, which can be downloaded', async ({ page }) => {
  await openDatabaseTab(page);
  const links = page.locator('.transcript-link');
  await expect(links).toHaveCount(1); // only the post with a transcribed video
  await links.click();

  const dialog = page.locator('#transcript-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#transcript-body')).toHaveText(TRANSCRIPT, { useInnerText: true });
  await expect(page.locator('#transcript-meta')).toContainText('Teszt Szerző');
  expect(await page.evaluate(() => window.__posted.find((m) => m.type === 'transcript').id)).toBe(2);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#transcript-download').click()]);
  expect(download.suggestedFilename()).toBe('leirat_teszt-szerzo_2020-05-02_222.txt');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(TRANSCRIPT);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(links).toBeFocused();
});
