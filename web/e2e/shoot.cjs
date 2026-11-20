// Screenshots of the main screens against the mock backend. Run: node web/e2e/shoot.cjs <outdir> [width]
const { chromium } = require('playwright');
const { makeDb, install, signIn } = require('./mock.cjs');
const OUT = process.argv[2], W = Number(process.argv[3] || 390);
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  const p = await c.newPage(); const db = makeDb(); await install(p, db); await signIn(p);
  const shot = async (n) => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${n}.png` }); };
  await p.goto('http://localhost:5173/'); await p.getByRole('button', { name: 'Add payment' }).waitFor(); await shot('1-dashboard');
  await p.getByRole('button', { name: 'History' }).click(); await shot('2-history');
  await p.locator('.dayhead2').nth(1).click(); await shot('3-history-open');
  await p.getByRole('button', { name: 'Close day' }).first().click(); await shot('4-close-sheet');
  await p.getByRole('button', { name: 'Go back' }).click();
  await p.locator('.daycard', { hasText: 'No entries' }).first().locator('.dayhead2').click();
  await p.getByRole('button', { name: 'Close day' }).last().click(); await shot('5-close-empty');
  await b.close();
})();
