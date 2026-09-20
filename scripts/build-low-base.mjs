import fs from 'node:fs/promises';

const num = v => {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(String(v).replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
};
const normDate = v => {
  const s = String(v ?? '').replace(/[^0-9]/g, '');
  if (s.length === 8) return s;
  if (s.length === 7) return String(Number(s.slice(0, 3)) + 1911) + s.slice(3);
  return s;
};

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json,text/plain,*/*' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const [twse, tpex] = await Promise.all([
  getJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
  getJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
]);

const rows = {};
let latestDate = '';

for (const x of twse) {
  const code = String(x.Code ?? '').trim();
  const close = num(x.ClosingPrice);
  const value = num(x.TradeValue ?? x.TransactionAmount ?? x.TransactionValue);
  const volume = num(x.TradeVolume ?? x.TradingShares ?? x.TradingVolume);
  const date = normDate(x.Date);
  if (!/^\d{4}$/.test(code) || close == null || close <= 0 || !date) continue;
  rows[code] = { close, value: value != null && value > 0 ? value : (volume != null && volume > 0 ? volume * close : 1), volume, date, market: 'tse', source: value != null && value > 0 ? '證交所官方成交金額' : '證交所成交量×收盤價' };
  if (date > latestDate) latestDate = date;
}

for (const x of tpex) {
  const code = String(x.SecuritiesCompanyCode ?? x.Code ?? '').trim();
  const close = num(x.Close ?? x.ClosingPrice ?? x.ClosePrice);
  const value = num(x.TransactionAmount ?? x.TradeValue ?? x.TransactionValue);
  const volume = num(x.TradingShares ?? x.TradeVolume ?? x.TradingVolume);
  const date = normDate(x.Date);
  if (!/^\d{4}$/.test(code) || close == null || close <= 0 || !date) continue;
  rows[code] = { close, value: value != null && value > 0 ? value : (volume != null && volume > 0 ? volume * close : 1), volume, date, market: 'otc', source: value != null && value > 0 ? '櫃買官方成交金額' : '櫃買成交量×收盤價' };
  if (date > latestDate) latestDate = date;
}

if (!latestDate || Object.keys(rows).length < 1000) throw new Error(`Official quote snapshot validation failed: date=${latestDate}, rows=${Object.keys(rows).length}`);

let existing = { generatedAt: null, stocks: {} };
try { existing = JSON.parse(await fs.readFile('public/low-base.json', 'utf8')); } catch {}
for (const [code, quote] of Object.entries(rows)) existing.stocks[code] = { ...(existing.stocks[code] || {}), ...quote };
existing.generatedAt = new Date().toISOString();
existing.dataDate = latestDate;
existing.source = 'TWSE/TPEx official daily close snapshot; turnover fallback volume × close';
await fs.writeFile('public/low-base.json', JSON.stringify(existing));
console.log(`Updated official quote fallback: date=${latestDate}, stocks=${Object.keys(rows).length}`);
console.log('8299', existing.stocks['8299']);
console.log('5351', existing.stocks['5351']);
console.log('3260', existing.stocks['3260']);