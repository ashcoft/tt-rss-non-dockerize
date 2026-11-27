import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:18090/index.php';
const out = [];
const check = (name, ok, detail) => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const b = await chromium.launch();

// --- narrow layout: closed drawer must be inert and unreachable by Tab
const narrow = await b.newPage({ viewport: { width: 390, height: 844 } });
await narrow.goto(BASE);
await narrow.waitForSelector('.feed-list', { timeout: 20000 });

const inertClosed = await narrow.locator('aside.sidebar').evaluate((el) => ({
  inert: el.inert === true || el.hasAttribute('inert'),
  ariaHidden: el.getAttribute('aria-hidden'),
}));
check('closed drawer is inert', inertClosed.inert, JSON.stringify(inertClosed));

await narrow.locator('body').click({ position: { x: 5, y: 5 } });
let inside = 0;
for (let i = 0; i < 12; i++) {
  await narrow.keyboard.press('Tab');
  const where = await narrow.evaluate(() => {
    const a = document.activeElement;
    return a ? { inSidebar: Boolean(a.closest('.sidebar')), tag: a.tagName, label: a.getAttribute('title') || a.getAttribute('aria-label') || '' } : null;
  });
  if (where?.inSidebar) inside++;
}
check('Tab never enters the closed drawer', inside === 0, `${inside} of 12 stops inside`);

// --- narrow layout: opening the drawer restores it, Enter on the backdrop closes it
await narrow.locator('.nav-toggle').click();
const openState = await narrow.locator('aside.sidebar').evaluate((el) => ({ inert: el.inert, open: el.classList.contains('open') }));
check('open drawer is interactive', openState.open && !openState.inert, JSON.stringify(openState));

await narrow.locator('.sidebar-backdrop').focus();
await narrow.keyboard.press('Enter');
await narrow.waitForTimeout(300);
const closedAgain = await narrow.evaluate(() => ({
  backdrop: Boolean(document.querySelector('.sidebar-backdrop')),
  open: Boolean(document.querySelector('.sidebar.open')),
  articleOpen: Boolean(document.querySelector('.article-panel')),
}));
check('Enter on backdrop closes the drawer', !closedAgain.backdrop && !closedAgain.open, JSON.stringify(closedAgain));
check('Enter on backdrop does not open an article', !closedAgain.articleOpen);

// --- desktop just above the breakpoint, with the article panel open
const wide = await b.newPage({ viewport: { width: 901, height: 900 } });
await wide.goto(BASE);
await wide.waitForSelector('.feed-list', { timeout: 20000 });
await wide.locator('.feed-list').getByText('All articles', { exact: true }).click();
await wide.waitForSelector('.headlines-list-content .v-list-item', { timeout: 15000 });
await wide.locator('.headlines-list-content .v-list-item').first().click();
await wide.waitForTimeout(800);

const metrics = await wide.evaluate(() => {
  const content = document.querySelector('.content');
  const toolbar = document.querySelector('.toolbar');
  const right = toolbar.getBoundingClientRect().right;
  const contentRight = content.getBoundingClientRect().right;
  const buttons = [...toolbar.querySelectorAll('button')].map((el) => el.getBoundingClientRect().right);
  return {
    contentWidth: Math.round(content.clientWidth),
    toolbarClient: Math.round(toolbar.clientWidth),
    toolbarScroll: Math.round(toolbar.scrollWidth),
    overflow: Math.round(right - contentRight),
    furthestButton: Math.round(Math.max(...buttons)),
    contentRight: Math.round(contentRight),
    articleOpen: Boolean(document.querySelector('.article-panel')),
  };
});
check('article panel is open at 901px', metrics.articleOpen, `content=${metrics.contentWidth}px`);
check('toolbar does not overflow its pane', metrics.toolbarScroll <= metrics.toolbarClient + 1, JSON.stringify(metrics));
check('all toolbar buttons are inside the pane', metrics.furthestButton <= metrics.contentRight + 1, `furthest=${metrics.furthestButton} pane=${metrics.contentRight}`);

await b.close();
console.log(out.join('\n'));
if (out.some((l) => l.startsWith('FAIL'))) process.exitCode = 1;
