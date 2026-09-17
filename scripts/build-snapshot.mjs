import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

let mapping;
try { mapping=JSON.parse(await fs.readFile('public/mapping.json','utf8')); }
catch {
  const old=execFileSync('git',['show','ad4aee46620456bd4732b94bae539fd0c4f78765:public/app.js'],{encoding:'utf8'});
  const m=old.match(/const MEMBERS=(\{[\s\S]*?\});\nlet quotes/);
  if(!m) throw Error('mapping recovery failed');
  mapping=JSON.parse(m[1]);
  await fs.writeFile('public/mapping.json',JSON.stringify(mapping));
}

const MEMBERS=mapping;
const CATEGORIES=Object.keys(MEMBERS);
const wanted=new Set(Object.values(MEMBERS).flat());
const n=v=>{ if(v==null)return null; const x=Number(String(v).replaceAll(',','').replace(/[^0-9.-]/g,'')); return Number.isFinite(x)?x:null; };
const ymd=d=>`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
const slash=s=>`${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url){
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json,text/plain,*/*'}});
  if(!r.ok) throw Error(`${r.status} ${url}`);
  return r.json();
}
function parseTwse(j){
  const out={};
  for(const t of j.tables||[]){
    const f=t.fields||[], ci=f.findIndex(x=>String(x).includes('證券代號')), vi=f.findIndex(x=>String(x).includes('成交金額'));
    if(ci<0||vi<0) continue;
    for(const r of t.data||[]){ const c=String(r[ci]||'').trim(),v=n(r[vi]); if(wanted.has(c)&&v!=null) out[c]=v; }
    if(Object.keys(out).length) break;
  }
  return out;
}
function parseTpex(j){
  const out={};
  const tables=j.tables||[];
  for(const t of tables){
    const f=t.fields||[], ci=f.findIndex(x=>/代號/.test(String(x))), vi=f.findIndex(x=>String(x).includes('成交金額'));
    if(ci<0||vi<0) continue;
    for(const r of t.data||[]){ const c=String(r[ci]||'').trim(),v=n(r[vi]); if(wanted.has(c)&&v!=null) out[c]=v*1000; }
  }
  const rows=Array.isArray(j.aaData)?j.aaData:Array.isArray(j.data)?j.data:[];
  if(rows.length){
    const fields=j.fields||j.columnNames||[];
    let ci=fields.findIndex(x=>/代號/.test(String(x))),vi=fields.findIndex(x=>String(x).includes('成交金額'));
    if(ci<0)ci=0;
    if(vi>=0) for(const r of rows){const c=String(r[ci]||'').trim(),v=n(r[vi]);if(wanted.has(c)&&v!=null)out[c]=v*1000;}
  }
  return out;
}
async function fetchDay(date){
  const [a,b]=await Promise.allSettled([
    getJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date}&type=ALLBUT0999&response=json`),
    getJson(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${encodeURIComponent(slash(date))}&response=json`)
  ]);
  const vals={};
  if(a.status==='fulfilled')Object.assign(vals,parseTwse(a.value));
  if(b.status==='fulfilled')Object.assign(vals,parseTpex(b.value));
  return vals;
}

const now=new Date(Date.now()+8*3600e3), dates=[], valuesByDate={};
for(let back=1;back<=35&&dates.length<10;back++){
  const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-back));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  const date=ymd(d);
  try{
    const vals=await fetchDay(date);
    if(Object.keys(vals).length>20){dates.push(date);valuesByDate[date]=vals;console.log(`official ${date}: ${Object.keys(vals).length} mapped stocks`);}
  }catch(e){console.warn(`skip ${date}: ${e.message}`);}
  await sleep(250);
}
dates.sort();
if(dates.length<10)throw Error(`Only ${dates.length}/10 trading days were recovered`);

const days=[];
for(const date of dates){
  const stock=valuesByDate[date], sectors=[];
  for(const name of CATEGORIES){
    const cs=[...new Set(MEMBERS[name]||[])]; let value=0,covered=0;
    for(const c of cs)if(stock[c]!=null){value+=stock[c];covered++;}
    sectors.push({name,value,covered,total:cs.length});
  }
  const rankable=sectors.filter(x=>x.covered===x.total).sort((a,b)=>b.value-a.value),ranks={};
  rankable.forEach((x,i)=>ranks[x.name]=i+1);
  days.push({date,ranks,complete:rankable.length,total:CATEGORIES.length});
}
const latest=dates.at(-1), latestStocks=valuesByDate[latest],prevValues={};
for(const name of CATEGORIES){
  const cs=[...new Set(MEMBERS[name]||[])];let value=0,covered=0;
  for(const c of cs)if(latestStocks[c]!=null){value+=latestStocks[c];covered++;}
  if(covered===cs.length)prevValues[name]=value;
}
const out={version:3,generatedAt:new Date().toISOString(),latestDate:latest,days,prevValues,source:'TWSE/TPEx official daily turnover'};
await fs.writeFile('public/rank-history.json',JSON.stringify(out));
console.log(`saved ${days.length} days, latest ${latest}, ${Object.keys(prevValues).length}/${CATEGORIES.length} complete sectors`);
