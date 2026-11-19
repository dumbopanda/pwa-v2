// Screenshots of the main screens against the mock backend. Run: node web/e2e/shoot.cjs <outdir>
const { chromium } = require('playwright');
const { makeDb, install, signIn } = require('./mock.cjs');
const OUT = process.argv[2], W = Number(process.argv[3] || 390);
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  const p = await c.newPage(); const db = makeDb(); await install(p, db); await signIn(p);
  const shot = async (n) => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${n}.png` }); };
  await p.goto('http://localhost:5173/'); await p.getByRole('button', { name: 'Add payment' }).waitFor(); await shot('1-dashboard');
  await p.getByRole('button', { name: 'Add payment' }).click(); await shot('2-addmenu');
  await p.getByRole('button', { name: 'Speak an entry' }).click(); await p.getByLabel('Say or type what you spent').fill('swiggy 340 upi');
  await shot('3-say'); await p.getByRole('button', { name: 'Read it' }).click(); await p.getByText('Add this entry?').waitFor(); await shot('4-confirm');
  await p.getByRole('button', { name: 'Close' }).click();
  await p.getByRole('button', { name: 'Add payment' }).click(); await p.getByRole('button', { name: 'Enter manually' }).click(); await shot('5-manual');
  await p.keyboard.press('Escape'); await p.getByRole('button', { name: 'History' }).click(); await shot('6-history');
  await b.close();
})();
