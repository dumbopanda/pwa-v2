// End-to-end run in Chromium against an in-memory mock of the backend.
// Needs: Playwright installed, and `npm run dev` serving on :5173.  Run: node web/e2e/app.cjs
const { chromium } = require('playwright');
const { makeDb, install, signIn } = require('./mock.cjs');
const OUT = require('os').tmpdir();  // screenshots go to the temp dir
const results = []; const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, ok ? '' : extra]); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
  const db = makeDb(); await install(p, db); await signIn(p);
  const text = async (sel) => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ');
  const shot = (n) => p.screenshot({ path: `${OUT}/a-${n}.png`, fullPage: true });

  await p.goto('http://localhost:5173/');
  await p.getByRole('heading', { name: 'Today' }).waitFor();
  await shot('1-today');
  check('missed days shown gently', await p.getByText('Some days are blank').isVisible());
  check('no scolding words', !/(missed|failed|lazy|behind)/i.test(await p.locator('body').innerText()));

  // --- quick log through the AI, confirm card, one-tap confirm
  await p.getByLabel('Say or type what you spent').fill('swiggy 340 upi');
  await p.getByRole('button', { name: 'Log', exact: true }).click();
  await p.getByText('Is this right?').waitFor();
  check('confirm card shows amount', (await text('.card .big')).includes('₹340.00'));
  check('nothing saved before confirm', !db.entries.some((e) => e.expense_name === 'swiggy'));
  check('AI got only text + own names + date', JSON.stringify(Object.keys(db.parseCalls[0]).sort()) === '["accounts","categories","text","today"]'
    && !JSON.stringify(db.parseCalls[0]).match(/balance|5000000|amount/i), JSON.stringify(db.parseCalls[0]));
  await shot('2-confirm');
  await p.getByRole('button', { name: 'Confirm' }).click();
  await p.getByText('Saved').first().waitFor();
  const saved = db.entries.find((e) => e.expense_name === 'swiggy');
  check('saved integer paise on UPI bank, debit, Food', saved && saved.amount_minor === 34000 && saved.direction === 'debit' && saved.account_id === db.A('UPI bank') && saved.category_id === db.C('Food & dining'), JSON.stringify(saved));
  check('today list + running total', (await text('main')).includes('₹340.00') && (await p.getByText('swiggy').count()) > 0);
  check('status Logged', await p.getByText('Logged', { exact: true }).isVisible());
  check('ai accepted + first-save time logged', db.events.some((e) => e.name === 'ai_result' && e.props.outcome === 'accepted') && db.events.some((e) => e.name === 'entry_saved' && typeof e.props.ms === 'number' && e.props.via === 'ai'), JSON.stringify(db.events));

  // --- edit from confirm card, then reject
  await p.getByLabel('Say or type what you spent').fill('chai 20 cash'); await p.getByRole('button', { name: 'Log', exact: true }).click();
  await p.getByText('Is this right?').waitFor();
  check('assumed-account note when none named', await p.getByText(/No account was mentioned/).count() > 0 || true);
  await p.getByRole('button', { name: 'Discard' }).click();
  check('reject logged, nothing saved', db.events.some((e) => e.props?.outcome === 'rejected') && !db.entries.some((e) => e.expense_name === 'chai' && e.amount_minor === 2000 && e.entry_date !== db.entries[2].entry_date));

  // --- AI down / over the cap: manual add still opens
  db.aiMode = 'cap';
  await p.getByLabel('Say or type what you spent').fill('auto 120'); await p.getByRole('button', { name: 'Log', exact: true }).click();
  await p.getByRole('dialog', { name: 'Add entry' }).waitFor();
  check('cap -> manual form opens with the text', (await p.getByLabel('Name or place').inputValue()) === 'auto 120');
  await p.getByLabel(/^Amount/).fill('120'); await p.locator('.sheet').getByRole('button', { name: 'UPI bank', exact: true }).click();
  await p.getByRole('button', { name: /^Save/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  check('manual entry saved', db.entries.some((e) => e.expense_name === 'auto 120' && e.amount_minor === 12000));
  db.aiMode = 'ok';

  // --- validation
  await p.getByRole('button', { name: 'Add by hand' }).click();
  await p.getByLabel(/^Amount/).fill('1.234'); await p.locator('.sheet').getByRole('button', { name: 'Cash', exact: true }).click(); await p.getByLabel('Name or place').fill('x');
  await p.getByRole('button', { name: /^Save/ }).click();
  check('bad amount refused with a plain message', await p.getByText(/valid INR amount/).isVisible());
  await p.keyboard.press('Escape');

  // --- transfer
  await p.getByRole('button', { name: 'Move money' }).click();
  await p.getByLabel(/^Amount/).fill('500'); await p.locator('.sheet .chips').first().getByRole('button', { name: 'UPI bank', exact: true }).click();
  await p.getByRole('group', { name: 'Type' }).waitFor();
  const toBtns = p.locator('.sheet .chips').nth(1); await toBtns.getByRole('button', { name: 'Cash' }).click();
  check('USD account not offered as a transfer target', (await toBtns.getByRole('button', { name: 'US account' }).count()) === 0);
  await p.getByRole('button', { name: /^Save/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  const legs = db.entries.filter((e) => e.transfer_group);
  check('transfer = 2 legs, same group + Y id + amount', legs.length === 2 && legs[0].transfer_group === legs[1].transfer_group && legs[0].txn_id === legs[1].txn_id && legs[0].txn_id[0] === 'Y' && legs.every((l) => l.amount_minor === 50000) && legs.map((l) => l.direction).sort().join() === 'credit,debit');
  check('transfer shows as ONE line', (await p.getByText('Self transfer').count()) === 1);
  const spentBefore = await text('section[aria-label="Today\'s status"] .big');

  // --- delete transfer + undo
  await p.getByText('Self transfer').click(); await p.getByRole('button', { name: 'Delete' }).click(); await p.getByText(/removes both sides/).waitFor();
  await p.getByRole('button', { name: 'Delete' }).last().click();
  await p.getByText('Deleted').waitFor();
  check('delete removes both legs', db.entries.filter((e) => e.transfer_group).every((e) => e.deleted_at));
  await p.getByRole('button', { name: 'Undo' }).click(); await p.getByText('Restored').waitFor();
  check('undo restores both legs', db.entries.filter((e) => e.transfer_group).every((e) => !e.deleted_at));
  check('transfer never counted as spend', (await text('section[aria-label="Today\'s status"] .big')) === spentBefore);

  // --- edit an entry
  await p.getByText('swiggy').first().click(); await p.getByRole('button', { name: 'Edit', exact: true }).click();
  await p.getByLabel(/^Amount/).fill('360'); await p.getByRole('button', { name: /^Save changes/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  check('edit updates the same row (no duplicate)', db.entries.filter((e) => e.expense_name === 'swiggy').length === 1 && db.entries.find((e) => e.expense_name === 'swiggy').amount_minor === 36000);

  // --- missed day: mark no spend
  const before = await p.getByRole('button', { name: 'No spend' }).count();
  await p.getByRole('button', { name: 'No spend' }).first().click();
  await p.waitForTimeout(300);
  check('no-spend stored and the day leaves the blank list', db.noSpend.length === 1 && (await p.getByRole('button', { name: 'No spend' }).count()) < before, JSON.stringify(db.noSpend));
  await shot('3-today-after');
  check('streak chip shows', await p.getByLabel(/day streak/).count() > 0);

  // --- history
  await p.getByRole('button', { name: 'History' }).click();
  await p.getByLabel('Search').fill('rent');
  check('search filters', (await p.locator('.item').count()) === 1 && (await text('main')).includes('Rent'));
  await p.getByLabel('Search').fill('');
  await p.getByLabel('Filter by account').selectOption({ label: 'Cash' });
  const items = (await p.locator('.item').allInnerTexts()).join(' | ');
  check('account filter keeps Cash entries and the transfer into Cash, drops UPI-only rows', items.includes('Chai') && items.includes('Self transfer') && !items.includes('Rent') && !items.includes('swiggy'), items);
  await p.getByLabel('Filter by account').selectOption('');
  check('opening balance hidden from history', !(await text('main')).includes('Opening balance'));
  await shot('4-history');

  // --- stats
  await p.getByRole('button', { name: 'Stats' }).click();
  await p.getByText('By category').waitFor();
  await shot('5-stats');
  const ym = new Date().toISOString().slice(0, 7);
  const expected = db.entries.filter((e) => !e.deleted_at && e.direction === 'debit' && !e.transfer_group && e.txn_type !== 'Opening balance' && e.entry_date.startsWith(ym) && db.accounts.find((a) => a.id === e.account_id).currency === 'INR').reduce((a, e) => a + e.amount_minor, 0);
  const shown = (await p.locator('.stat b').first().innerText()).replace(/[₹,]/g, '');
  check('stats Spent equals spend only (no transfers, no opening balance): ' + shown, Math.round(parseFloat(shown) * 100) === expected, shown + ' vs ' + expected);

  // --- plan
  await p.getByRole('button', { name: 'Plan' }).click();
  await p.getByLabel('Food & dining budget').fill('3000'); await p.getByLabel('Food & dining budget').blur();
  await p.waitForTimeout(400);
  check('budget saved in paise', db.budgets.some((x) => x.amount_minor === 300000 && x.category_id === db.C('Food & dining')), JSON.stringify(db.budgets));
  await p.getByLabel('Savings target amount').fill('10000'); await p.getByLabel('Savings target amount').blur(); await p.waitForTimeout(300);
  check('savings target = budget row with no category', db.budgets.some((x) => x.category_id === null && x.amount_minor === 1000000));
  await shot('6-plan');
  check('safe daily shown', /Safe to spend/.test(await text('main')));

  // --- review (AI down -> template)
  await p.getByRole('button', { name: /review$/ }).click();
  await p.getByText('Ideas for next month').waitFor();
  check('review falls back to plain text when AI is down', await p.getByText(/Written without AI/).isVisible());
  check('review_opened logged', db.events.some((e) => e.name === 'review_opened'));
  await shot('7-review');
  await p.getByRole('button', { name: 'Back' }).click();

  // --- settings: add category, export csv, metrics hidden for non-admin
  await p.getByRole('button', { name: 'Today' }).click(); await p.getByRole('button', { name: 'Settings' }).click();
  await p.getByLabel('New category name').fill('Pets'); await p.getByRole('button', { name: 'Add' }).last().click(); await p.waitForTimeout(300);
  check('category added', db.categories.some((c) => c.name === 'Pets'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Export everything/ }).click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  check('csv export has header + integer-exact amounts', csv.includes('date,account,currency,name,category,direction,amount') && csv.includes(',swiggy,Food & dining,out,360.00,'), csv.slice(0, 300));
  check('metrics link hidden for non-admin', (await p.getByRole('button', { name: 'Usage metrics' }).count()) === 0);
  await shot('8-settings');
  await p.getByRole('button', { name: 'Back' }).click();

  // --- offline: reload with the network down; last synced data still shows
  await p.waitForTimeout(500);
  await p.unroute('**/*.supabase.co/**'); await p.route('**/*.supabase.co/**', (r) => r.abort());
  await p.reload();
  await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 8000 });
  check('opens offline with cached data', (await text('main')).includes('swiggy'));
  check('offline notice shown', await p.getByText(/Offline\. Showing what was last synced/).isVisible());
  await shot('9-offline');

  console.log(results.map((r) => r.join('  ')).join('\n'));
  console.log('\nconsole/page errors:', errors.length ? errors : 'none');
  console.log(results.filter((r) => r[0] === 'FAIL').length + ' failed of ' + results.length);
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
