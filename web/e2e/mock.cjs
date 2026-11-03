// A tiny in-memory stand-in for the Supabase REST API, enough for the app's flows.
let seq = 0;
const ts = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 1000).toISOString().replace('Z', '000+00:00');
const uuid = () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
const iso = (d) => d.toISOString().slice(0, 10);
exports.makeDb = () => {
  const today = new Date(); const day = (n) => iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - n)));
  const db = { calls: [], events: [], noSpend: [], budgets: [], aiMode: 'ok', parseCalls: [], reviewMode: 'fail' };
  const acc = (name, cur = 'INR') => ({ id: uuid(), client_uid: 'cu-' + name, name, currency: cur, sort_order: 0, archived_at: null, deleted_at: null, updated_at: ts(), created_at: ts() });
  db.accounts = [acc('UPI bank'), acc('Cash'), acc('Credit card'), acc('US account', 'USD')];
  const cat = (name) => ({ id: uuid(), client_uid: 'cc-' + name, name, sort_order: 0, archived_at: null, deleted_at: null, updated_at: ts() });
  db.categories = ['Food & dining', 'Transport', 'Salary', 'Rent'].map(cat);
  const A = (n) => db.accounts.find((a) => a.name === n).id, C = (n) => db.categories.find((c) => c.name === n).id;
  const ent = (o) => ({ id: uuid(), client_uid: 'e-' + seq, txn_id: 'Nabcdef', category_id: null, more_info: null, txn_type: 'Payment', direction: 'debit', transfer_group: null, created_at: ts(), updated_at: ts(), deleted_at: null, ...o });
  db.entries = [
    ent({ entry_date: day(4), account_id: A('UPI bank'), expense_name: 'Opening balance', txn_type: 'Opening balance', amount_minor: 5000000, direction: 'credit' }),
    ent({ entry_date: day(3), account_id: A('UPI bank'), expense_name: 'Rent', category_id: C('Rent'), amount_minor: 1500000 }),
    ent({ entry_date: day(1), account_id: A('Cash'), expense_name: 'Chai', category_id: C('Food & dining'), amount_minor: 2000 }),
  ];
  db.profile = { currency: 'INR', onboarded_at: new Date(Date.now() - 5 * 86400000).toISOString() };
  db.A = A; db.C = C;
  return db;
};
exports.install = async (page, db) => {
  await page.route('**/*.supabase.co/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    const obj = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const body = () => { try { return req.postDataJSON(); } catch { return null; } };
    const ok = (json, status = 200) => r.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
    const q = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    db.calls.push(m + ' ' + p);

    if (p === '/rest/v1/profiles') return ok(obj ? db.profile : [db.profile]);
    if (p === '/rest/v1/budgets') {
      if (m === 'GET') return ok(db.budgets);
      if (m === 'POST') { const rows = [].concat(body()); rows.forEach((b) => db.budgets.push({ id: uuid(), ...b })); return ok([], 201); }
      if (m === 'PATCH') { Object.assign(db.budgets.find((b) => b.id === q('id')), body()); return ok([], 204); }
      if (m === 'DELETE') { db.budgets = db.budgets.filter((b) => b.id !== q('id')); return ok([], 204); }
    }
    if (p === '/rest/v1/day_status') {
      if (m === 'GET') return ok(db.noSpend.map((date) => ({ date, status: 'no_spend' })));
      if (m === 'POST') { const b = body(); if (!db.noSpend.includes(b.date)) db.noSpend.push(b.date); return ok([], 201); }
      if (m === 'DELETE') { db.noSpend = db.noSpend.filter((d) => d !== q('date')); return ok([], 204); }
    }
    if (p === '/rest/v1/events') { db.events.push(body()); return ok([], 201); }
    if (p === '/rest/v1/rpc/admin_metrics') return ok({ message: 'not_admin', code: '42501' }, 403);
    if (/\/rpc\/pull_(accounts|categories|entries)$/.test(p)) {
      const k = p.endsWith('accounts') ? 'accounts' : p.endsWith('categories') ? 'categories' : 'entries';
      const b = body(); const rows = db[k].filter((x) => !b.p_since || x.updated_at > b.p_since).sort((a, c) => a.updated_at.localeCompare(c.updated_at));
      return ok(rows.slice(0, b.p_limit));
    }
    if (p.endsWith('/rpc/push_entries')) {
      const out = [];
      for (const row of body().p_rows) {
        let e = db.entries.find((x) => x.client_uid === row.client_uid);
        if (e) { const del = e.deleted_at || row.deleted_at; Object.assign(e, row, { deleted_at: del, updated_at: ts() }); }
        else { e = { id: uuid(), created_at: ts(), updated_at: ts(), ...row, deleted_at: row.deleted_at ?? null }; db.entries.push(e); }
        if (row.deleted_at && e.transfer_group) db.entries.filter((x) => x.transfer_group === e.transfer_group && !x.deleted_at).forEach((x) => { x.deleted_at = row.deleted_at; x.updated_at = ts(); });
        out.push({ client_uid: e.client_uid, id: e.id, updated_at: e.updated_at, was_insert: true });
      }
      return ok(out);
    }
    if (p === '/rest/v1/entries' && m === 'PATCH') {
      db.entries.filter((x) => (q('transfer_group') ? x.transfer_group === q('transfer_group') : x.id === q('id'))).forEach((x) => { x.deleted_at = null; x.updated_at = ts(); });
      return ok([], 204);
    }
    if (p === '/rest/v1/categories' && m === 'POST') { const c = { id: uuid(), archived_at: null, deleted_at: null, updated_at: ts(), ...body() }; db.categories.push(c); return ok(c, 201); }
    if (p === '/rest/v1/categories' && m === 'PATCH') { const c = db.categories.find((x) => x.id === q('id')); Object.assign(c, body(), { updated_at: ts() }); return ok(c); }
    if (p === '/rest/v1/accounts' && m === 'PATCH') { const c = db.accounts.find((x) => x.id === q('id')); Object.assign(c, body(), { updated_at: ts() }); return ok(c); }
    if (p === '/rest/v1/accounts' && m === 'POST') { const c = { id: uuid(), archived_at: null, deleted_at: null, updated_at: ts(), ...body() }; db.accounts.push(c); return ok(c, 201); }

    if (p === '/functions/v1/parse-entry') {
      const b = body(); db.parseCalls.push(b);
      if (db.aiMode === 'cap') return ok({ error: 'daily_cap' }, 429);
      if (db.aiMode === 'down') return ok({ error: 'ai_unavailable' }, 503);
      const t = b.text.toLowerCase(); const amt = (t.match(/\d+/) || [null])[0];
      return ok({ proposal: { amount_minor: amt ? Number(amt) * 100 : null, currency: null, account: /upi/.test(t) ? 'UPI bank' : null, transfer_to: null, category: /swiggy|chai/.test(t) ? 'Food & dining' : null,
        name: t.split(' ')[0], direction: /salary/.test(t) ? 'received' : 'spent', date: b.today, note: null, confidence: 0.9 } });
    }
    if (p === '/functions/v1/month-review') {
      if (db.reviewMode === 'fail') return ok({ error: 'ai_unavailable' }, 503);
      return ok({ review: { summary: 'A calm month.', suggestions: ['One.', 'Two.', 'Three.'] } });
    }
    if (p.startsWith('/auth/')) return ok({}, 200);
    return ok({ message: 'mock: unhandled ' + m + ' ' + p }, 404);
  });
};
exports.signIn = async (page) => {
  const uid = '11111111-1111-1111-1111-111111111111', exp = Math.floor(Date.now() / 1000) + 36000;
  const jwt = 'x.' + Buffer.from(JSON.stringify({ sub: uid, exp, role: 'authenticated' })).toString('base64url') + '.y';
  await page.addInitScript(([jwt, uid, exp]) => localStorage.setItem('sb-mxodmmsnyzrdklyzhibt-auth-token', JSON.stringify({
    access_token: jwt, refresh_token: 'r', expires_at: exp, expires_in: 36000, token_type: 'bearer',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })), [jwt, uid, exp]);
};
