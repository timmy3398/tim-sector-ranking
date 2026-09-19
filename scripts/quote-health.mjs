import fs from 'node:fs/promises';

const workerUrl = process.env.WORKER_URL || 'https://tim-sector-ranking.timmy3398.workers.dev';
const samples = ['2881','2882','3680','3131','6147','3259','5347','3707','3372'];
const out = { commit: process.env.GITHUB_SHA || null, workerUrl, samples };

async function getRaw(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept': 'application/json,text/plain,*/*',
      'cache-control': 'no-cache'
    }
  });
  return { status: r.status, body: await r.text() };
}
const num = v => {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(String(v).replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
};

try {
  const [tw, ot] = await Promise.all([
    getRaw('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
    getRaw('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
  ]);
  out.officialStatus = { twse: tw.status, tpex: ot.status };
  if (tw.status !== 200 || ot.status !== 200) {
    throw new Error('Official API status ' + JSON.stringify(out.officialStatus));
  }

  const twj = JSON.parse(tw.body);
  const otj = JSON.parse(ot.body);
  const official = {};
  for (const x of twj) {
    const c = String(x.Code ?? '').trim();
    if (samples.includes(c)) {
      official[c] = {
        market: 'tse',
        close: num(x.ClosingPrice),
        value: num(x.TradeValue ?? x.TransactionAmount ?? x.TransactionValue)
      };
    }
  }
  for (const x of otj) {
    const c = String(x.SecuritiesCompanyCode ?? x.Code ?? '').trim();
    if (samples.includes(c)) {
      official[c] = {
        market: 'otc',
        close: num(x.ClosingPrice ?? x.Close ?? x.ClosePrice),
        value: num(x.TradeValue ?? x.TransactionAmount ?? x.TransactionValue)
      };
    }
  }
  out.official = official;

  const live = await getRaw(workerUrl + '/api/quotes?codes=' + samples.join(',') + '&v=' + (process.env.GITHUB_SHA || Date.now()));
  out.liveStatus = live.status;
  out.liveBody = live.body.slice(0, 10000);
  if (live.status !== 200) throw new Error('Worker HTTP ' + live.status);

  const lj = JSON.parse(live.body);
  out.live = lj.quotes || {};
  const bad = [];
  for (const c of samples) {
    const o = official[c], q = out.live[c];
    if (!q) { bad.push(c + ' missing'); continue; }
    if (o && Number(q.close) !== Number(o.close)) bad.push(c + ' close ' + q.close + ' != ' + o.close);
    if (o && o.value != null && q.value != null && Number(q.value) !== Number(o.value)) bad.push(c + ' value ' + q.value + ' != ' + o.value);
    if (q.close == null || q.value == null || Number(q.close) <= 0 || Number(q.value) <= 0) bad.push(c + ' invalid ' + JSON.stringify(q));
  }
  out.bad = bad;
  await fs.writeFile('/tmp/quote-health.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (bad.length) throw new Error('Quote validation failed: ' + bad.join(' | '));
  console.log('PASS: sample quotes match official data.');
} catch (e) {
  out.error = String(e);
  await fs.writeFile('/tmp/quote-health.json', JSON.stringify(out, null, 2));
  console.error(JSON.stringify(out, null, 2));
  process.exitCode = 1;
}
