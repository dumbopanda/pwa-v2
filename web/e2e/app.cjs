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
  await p.getByRole('button', { name: 'Add payment' }).waitFor();
  await shot('1-dashboard');
  check('no today-status card on the dashboard', !(await p.locator('body').innerText()).includes('Nothing logged today'));
  check('no scolding words', !/(missed|failed|lazy|behind)/i.test(await p.locator('body').innerText()));
  const say = async (t) => {
    await p.getByRole('button', { name: 'Add payment' }).click(); await p.getByRole('button', { name: 'Speak an entry' }).click();
    await p.getByLabel('Say or type what you spent').fill(t); await p.getByRole('button', { name: 'Read it' }).click();
  };
  const manual = async () => { await p.getByRole('button', { name: 'Add payment' }).click(); await p.getByRole('button', { name: 'Enter manually' }).click(); };
  const card = () => p.getByRole('dialog', { name: 'Add this entry?' });
  const discard = () => card().getByRole('button', { name: 'Close' }).click();
  const status = () => text('.duo');  // this month's Money out / Money in

  // --- Add payment -> mic (typed here) -> "Add this entry?" -> one tap
  await say('swiggy 340 upi');
  await card().waitFor();
  check('confirm sheet shows amount', (await card().locator('.fact .v').first().innerText()).includes('₹340'));
  check('nothing saved before confirm', !db.entries.some((e) => e.expense_name === 'swiggy'));
  check('clear entry read on the phone: no AI call', db.parseCalls.length === 0 && await card().getByText('on your phone').isVisible(), JSON.stringify(db.parseCalls));
  await shot('2-confirm');
  await p.getByRole('button', { name: 'Add entry' }).click();
  await p.getByText('Saved').first().waitFor();
  const saved = db.entries.find((e) => e.expense_name === 'swiggy');
  check('saved integer paise on UPI bank, debit, Food', saved && saved.amount_minor === 34000 && saved.direction === 'debit' && saved.account_id === db.A('UPI bank') && saved.category_id === db.C('Food & dining'), JSON.stringify(saved));
  check('dashboard Money out includes it', (await status()).includes('₹15,360'), await status());  // rent 15,000 + chai 20 + swiggy 340
  const rc = db.events.find((e) => e.name === 'read_check');
  check('accuracy log: said + read + saved, no audio', rc && rc.props.said === 'swiggy 340 upi' && rc.props.outcome === 'accepted' && rc.props.read.amt === '340.00' && rc.props.saved.acc === 'UPI bank', JSON.stringify(rc));
  check('ai accepted + first-save time logged', db.events.some((e) => e.name === 'ai_result' && e.props.outcome === 'accepted') && db.events.some((e) => e.name === 'entry_saved' && typeof e.props.ms === 'number' && e.props.via === 'ai'), JSON.stringify(db.events));

  // --- an unclear entry goes to the AI, with only the text + own names + date
  await say('dinner around 450 card');
  await card().waitFor();
  check('unclear entry goes to the AI', db.parseCalls.length === 1 && await card().getByText('by AI').isVisible());
  check('AI got only text + own names + date', JSON.stringify(Object.keys(db.parseCalls[0]).sort()) === '["accounts","categories","text","today"]'
    && !JSON.stringify(db.parseCalls[0]).match(/balance|5000000|amount/i), JSON.stringify(db.parseCalls[0]));
  await discard();
  check('rejected read logged with its text', db.events.some((e) => e.name === 'read_check' && e.props.outcome === 'rejected' && e.props.said === 'dinner around 450 card' && e.props.saved === null));
  check('reject logged with its source', db.events.some((e) => e.props?.outcome === 'rejected' && e.props?.source === 'ai'));

  // --- AI down: a partial plain-code reading is still offered, marked as such
  db.aiMode = 'down';
  await say('approx 90 snacks');
  await card().waitFor();
  check('AI down: plain-code reading offered with a note', await p.getByText(/Read without AI this time/).isVisible() && (await card().locator('.fact .v').first().innerText()).includes('₹90'));
  await discard();

  // --- AI over its cap and nothing readable: the manual form opens with the text
  db.aiMode = 'cap';
  await say('paid the dhobi');
  await p.getByRole('dialog', { name: 'New entry' }).waitFor();
  check('cap -> manual form opens with the text', (await p.getByLabel('Name or place').inputValue()) === 'paid the dhobi');
  await p.getByLabel(/^Amount/).fill('120'); await p.locator('.sheet .tiles').getByRole('button', { name: 'UPI bank', exact: true }).click();
  await p.getByRole('button', { name: /^Save/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  check('manual entry saved', db.entries.some((e) => e.expense_name === 'paid the dhobi' && e.amount_minor === 12000));
  db.aiMode = 'ok';

  // --- validation
  await manual();
  await p.getByLabel(/^Amount/).fill('1.234'); await p.locator('.sheet .tiles').getByRole('button', { name: 'Cash', exact: true }).click(); await p.getByLabel('Name or place').fill('x');
  check('bad amount: Save stays disabled and the caption says why', await p.getByText(/valid INR amount/).isVisible() && await p.getByRole('button', { name: /^Save/ }).isDisabled());
  // --- currency: picking USD shows only USD accounts and the $ amount
  await p.getByLabel('Currency').selectOption('USD');
  const tilesUsd = await p.locator('.sheet .tiles').first().innerText();
  check('currency picker switches accounts', tilesUsd.includes('US account') && !tilesUsd.includes('Cash'), tilesUsd);
  await p.keyboard.press('Escape');

  // --- transfer
  const spentBefore = await status();
  await manual(); await p.getByRole('button', { name: 'Transfer' }).click();
  await p.getByLabel(/^Amount/).fill('500'); await p.locator('.sheet .tiles').first().getByRole('button', { name: 'UPI bank', exact: true }).click();
  const toBtns = p.locator('.sheet .tiles').nth(1); await toBtns.getByRole('button', { name: 'Cash' }).click();
  check('USD account not offered as a transfer target', (await toBtns.getByRole('button', { name: 'US account' }).count()) === 0);
  await p.getByRole('button', { name: /^Save/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  const legs = db.entries.filter((e) => e.transfer_group);
  check('transfer = 2 legs, same group + Y id + amount', legs.length === 2 && legs[0].transfer_group === legs[1].transfer_group && legs[0].txn_id === legs[1].txn_id && legs[0].txn_id[0] === 'Y' && legs.every((l) => l.amount_minor === 50000) && legs.map((l) => l.direction).sort().join() === 'credit,debit');
  check('transfer never counted as spend', (await status()) === spentBefore);

  // --- missed day: mark no spend
  check('no streak chip any more', (await p.getByLabel(/day streak/).count()) === 0);

  // --- in History: one line per transfer, delete + undo, edit
  await p.getByRole('button', { name: 'History' }).click();
  check('transfer shows as ONE line', (await p.getByText('Self transfer').count()) === 1);
  await p.getByText('Self transfer').click(); await p.getByRole('button', { name: 'Delete' }).click(); await p.getByText(/removes both sides/).waitFor();
  await p.getByRole('button', { name: 'Delete' }).last().click();
  await p.getByText('Deleted').waitFor();
  check('delete removes both legs', db.entries.filter((e) => e.transfer_group).every((e) => e.deleted_at));
  await p.getByRole('button', { name: 'Undo' }).click(); await p.getByText('Restored').waitFor();
  check('undo restores both legs', db.entries.filter((e) => e.transfer_group).every((e) => !e.deleted_at));
  await p.getByText('swiggy').first().click(); await p.getByRole('button', { name: 'Edit', exact: true }).click();
  await p.getByLabel(/^Amount/).fill('360'); await p.getByRole('button', { name: /^Save changes/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  check('edit updates the same row (no duplicate)', db.entries.filter((e) => e.expense_name === 'swiggy').length === 1 && db.entries.find((e) => e.expense_name === 'swiggy').amount_minor === 36000);

  // --- close day: open until you close it; closed stays closed; empty days warn first
  const dayN = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  await p.getByRole('button', { name: 'Dashboard' }).click();
  check('dashboard shows past open days in red (today never counts)', await p.getByText('5 days still open').isVisible());
  await p.getByRole('button', { name: /days still open/ }).click();
  check('card leads to History showing open days only', await p.getByRole('button', { name: 'Open days' }).getAttribute('aria-pressed') === 'true' && (await p.locator('.daycard').count()) === 5);
  await p.getByRole('button', { name: 'Open days' }).click();                      // back to the month
  const dbox = (label) => p.locator('.daycard', { has: p.locator('.dname2', { hasText: label }) });
  check('today is open', await dbox('Today').getByText('Open', { exact: true }).isVisible());
  await dbox('Today').getByRole('button', { name: 'Close day' }).click();
  await p.getByRole('dialog', { name: /^Close / }).getByText(/every payment for this day is added/).waitFor();
  await p.getByRole('dialog').getByRole('button', { name: 'Close day' }).click(); await p.getByText('Day closed').waitFor();
  check('today closed, stored once', Object.keys(db.closed).length === 1 && await dbox('Today').getByText('Closed', { exact: true }).isVisible());
  await manual(); await p.getByLabel(/^Amount/).fill('10'); await p.locator('.sheet .tiles').getByRole('button', { name: 'Cash', exact: true }).click(); await p.getByLabel('Name or place').fill('late tea');
  await p.getByRole('button', { name: /^Save/ }).click(); await p.getByRole('dialog').waitFor({ state: 'detached' });
  check('entry added to a closed day stays closed and is tagged Late', Object.keys(db.closed).length === 1 && await dbox('Today').getByText('Late', { exact: true }).isVisible());
  await dbox('Today').getByRole('button', { name: 'Reopen' }).click(); await p.getByText('Day reopened').waitFor();
  check('same-day reopen works', Object.keys(db.closed).length === 0 && await dbox('Today').getByText('Open', { exact: true }).isVisible());
  await dbox('Yesterday').locator('.dayhead2').click();
  await dbox('Yesterday').getByRole('button', { name: 'Close day' }).click(); await p.getByRole('dialog').getByRole('button', { name: 'Close day' }).click(); await p.getByText('Day closed').waitFor();
  check('past closed day has no Reopen', (await dbox('Yesterday').getByRole('button', { name: 'Reopen' }).count()) === 0 && Object.keys(db.closed).length === 1);
  const empty = p.locator('.daycard', { has: p.locator('.dname2 small', { hasText: new Date(dayN(2) + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) }) }).first();
  await empty.locator('.dayhead2').click(); await empty.getByRole('button', { name: 'Close day' }).click();
  await p.getByText('No payments are recorded for this day.').waitFor();
  await p.getByRole('dialog').getByRole('button', { name: 'Yes, I spent nothing' }).click(); await p.getByText('Closed as no spend').waitFor();
  check('empty day needs the "spent nothing" confirm, then closes', Object.keys(db.closed).length === 2);
  await p.getByRole('button', { name: 'Dashboard' }).click();
  check('open-day count drops as days close', await p.getByText('3 days still open').isVisible());
  check('days closed this month shown', await p.getByText(/of \d+ days closed/).isVisible());
  await p.getByRole('button', { name: 'History' }).click();

  // --- history
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  await p.getByLabel('Search all months').fill('rent');
  check('search filters across months', (await p.locator('.txn').count()) === 1 && (await text('main')).includes('Rent') && await p.getByText(/1 entry matching/).isVisible());
  await p.getByRole('button', { name: 'Clear search' }).click();
  await p.getByRole('button', { name: 'Transfers', exact: true }).click();
  check('type chip filters to transfers', (await p.locator('.txn').count()) === 1 && (await p.locator('.txn').first().innerText()).includes('Self transfer'));
  await p.getByRole('button', { name: 'All', exact: true }).click();
  await p.getByLabel('Filter by account').selectOption({ label: 'Cash' });
  const items = (await p.locator('.txn').allInnerTexts()).join(' | ');
  check('account filter keeps Cash entries and the transfer into Cash, drops UPI-only rows', items.includes('Chai') && items.includes('Self transfer') && !items.includes('Rent') && !items.includes('swiggy'), items);
  await p.getByLabel('Filter by account').selectOption('');
  check('opening balance hidden from history', !(await text('main')).includes('Opening balance'));
  await shot('4-history');

  // --- month pill: drag down = month before, drag up = month after (not past this month)
  const pill = p.getByRole('spinbutton', { name: /Month/ });
  const now = await pill.getAttribute('aria-valuetext');
  const box = await pill.boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 30, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
  const prevM = await pill.getAttribute('aria-valuetext');
  check('drag down shows the month before: ' + prevM, prevM !== now);
  await pill.focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(300);
  await p.keyboard.press('ArrowUp'); await p.waitForTimeout(300);
  check('up goes forward but never past this month', (await pill.getAttribute('aria-valuetext')) === now);

  // --- stats
  await p.getByRole('button', { name: 'Dashboard' }).click();
  await p.getByText('Where it went').waitFor();
  await shot('5-stats');
  const ym = new Date().toISOString().slice(0, 7);
  const expected = db.entries.filter((e) => !e.deleted_at && e.direction === 'debit' && !e.transfer_group && e.txn_type !== 'Opening balance' && e.entry_date.startsWith(ym) && db.accounts.find((a) => a.id === e.account_id).currency === 'INR').reduce((a, e) => a + e.amount_minor, 0);
  const shown = (await p.locator('.duo b').first().innerText()).replace(/[₹,]/g, '');
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
  await p.getByRole('button', { name: 'Settings' }).click();
  await p.getByLabel('New category name').fill('Pets'); await p.getByRole('button', { name: 'Add' }).last().click(); await p.waitForTimeout(300);
  check('category added', db.categories.some((c) => c.name === 'Pets'));
  // --- add accounts later WITH an opening balance (credit if you have it, debit if you owe it)
  await p.getByLabel('New account name').fill('Savings'); await p.getByLabel('New account balance today').fill('25,000.50');
  await p.getByRole('button', { name: 'Add account' }).click(); await p.getByText('Account added').waitFor();
  const sv = db.accounts.find((x) => x.name === 'Savings'); const svRow = db.entries.find((e) => e.account_id === sv?.id);
  check('new account gets a credit opening balance in paise', !!sv && svRow && svRow.amount_minor === 2500050 && svRow.direction === 'credit' && svRow.txn_type === 'Opening balance' && svRow.expense_name === 'Opening balance', JSON.stringify(svRow));
  await p.getByLabel('New account name').fill('Amex'); await p.getByLabel('New account balance today').fill('1200'); await p.getByLabel(/I owe this amount/).check();
  await p.getByRole('button', { name: 'Add account' }).click(); await p.getByText('Account added').waitFor();
  for (let i = 0; i < 20 && !db.entries.some((e) => e.account_id === db.accounts.find((x) => x.name === 'Amex')?.id); i++) await p.waitForTimeout(100);  // the toast may still be the first one
  const am = db.accounts.find((x) => x.name === 'Amex'); const amRow = db.entries.find((e) => e.account_id === am?.id);
  check('"I owe" gives a debit opening balance', !!am && amRow && amRow.amount_minor === 120000 && amRow.direction === 'debit', JSON.stringify(amRow));
  await p.getByLabel(/I owe this amount/).uncheck();
  await p.getByLabel('New account name').fill('Wallet'); await p.getByRole('button', { name: 'Add account' }).click(); await p.getByText('Account added').waitFor();
  const wl = db.accounts.find((x) => x.name === 'Wallet');
  check('no balance = no opening row', !!wl && !db.entries.some((e) => e.account_id === wl.id));
  // --- balance date: earlier date needs a confirm; payments can't go before it
  await p.getByLabel('New account name').fill('Backdated'); await p.getByLabel('New account balance today').fill('1000');
  await p.getByLabel('Balance as of').fill(dayN(2));
  check('earlier balance date warns and blocks Add until you choose', await p.getByText('Starting 2 days back').isVisible() && await p.getByRole('button', { name: 'Add account' }).isDisabled());
  await p.getByRole('button', { name: /^Keep / }).click();
  await p.getByRole('button', { name: 'Add account' }).click(); await p.getByText('Account added').waitFor();
  const bk = db.accounts.find((x) => x.name === 'Backdated'); const bkRow = db.entries.find((e) => e.account_id === bk?.id);
  check('opening balance is dated the chosen day', bkRow && bkRow.entry_date === dayN(2) && bkRow.amount_minor === 100000, JSON.stringify(bkRow));
  await p.getByRole('button', { name: 'Back' }).click();
  await manual(); await p.locator('.sheet .tiles').getByRole('button', { name: 'Backdated', exact: true }).click();
  await p.getByLabel('Date').fill(dayN(3));
  check('no payment before the balance date: Save disabled with a reason', await p.getByText(/balance starts/).isVisible() && await p.getByRole('button', { name: /^Save/ }).isDisabled());
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Settings' }).click();

  await p.getByLabel('New account name').fill('Bad'); await p.getByLabel('New account balance today').fill('12abc');
  await p.getByRole('button', { name: 'Add account' }).click(); await p.getByText(/doesn't look like an amount/).waitFor();
  check('bad balance refused, no account created', !db.accounts.some((x) => x.name === 'Bad'));
  // a failed balance save removes the account again, so a retry works
  db.failPush = true;
  await p.getByLabel('New account balance today').fill('500'); await p.getByLabel('New account name').fill('Flaky');
  await p.getByRole('button', { name: 'Add account' }).click(); await p.getByText(/Nothing was saved|Couldn't reach/).waitFor();
  const fl = db.accounts.find((x) => x.name === 'Flaky');
  check('failed balance save rolls the account back (tombstoned, name free)', !fl || !!fl.deleted_at, JSON.stringify(fl));
  db.failPush = false;

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
  await p.getByRole('button', { name: 'Add payment' }).waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: 'History' }).click();
  check('opens offline with cached data', (await text('main')).includes('swiggy'));
  check('offline notice shown', await p.getByText(/Offline\. Showing what was last synced/).isVisible());
  await shot('9-offline');

  console.log(results.map((r) => r.join('  ')).join('\n'));
  console.log('\nconsole/page errors:', errors.length ? errors : 'none');
  console.log(results.filter((r) => r[0] === 'FAIL').length + ' failed of ' + results.length);
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
