const { chromium } = require('playwright');
const { makeDb, install, signIn } = require('./mock.cjs');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1 });
  const p = await c.newPage(); const db = makeDb(); await install(p, db); await signIn(p);
  await p.goto('http://localhost:5173/'); await p.getByLabel('Say or type what you spent').waitFor(); await p.waitForTimeout(500);
  await p.screenshot({ path:`${OUT}/1-today.png` });
  for (const t of ['History','Stats','Plan']) { await p.getByRole('button', { name:t }).first().click(); await p.waitForTimeout(500); await p.screenshot({ path:`${OUT}/${t}.png` }); }
  await p.getByRole('button',{name:'Add',exact:true}).click(); await p.waitForTimeout(500); await p.screenshot({ path:`${OUT}/Add.png` });
  await b.close();
})();
