import fs from 'node:fs/promises';
const BASE=process.env.SITE_URL||'https://tim-sector-ranking.timmy3398.workers.dev';
const app=await fs.readFile('public/app.js','utf8');
const cat=app.match(/const CATEGORIES=(\[[\s\S]*?\]);/),mem=app.match(/const MEMBERS=(\{[\s\S]*?\});\nlet quotes/);if(!cat||!mem)throw Error('mapping parse failed');
const CATEGORIES=JSON.parse(cat[1]),MEMBERS=JSON.parse(mem[1]),codes=[...new Set(Object.values(MEMBERS).flat())].sort();
const j=await (await fetch(`${BASE}/api/history-snapshot?codes=${codes.join(',')}&snapshot=1`,{headers:{'cache-control':'no-cache'}})).json();if(!j.ok)throw Error(j.error||'history snapshot failed');
const dates=(j.dates||[]).slice(-10),rankByDate={};
for(const date of dates){const vals=CATEGORIES.map(name=>{let total=0,covered=0;for(const c of new Set(MEMBERS[name]||[])){const x=(j.values[c]||[]).find(r=>r.date===date);if(x?.value!=null){total+=x.value;covered++}}return{name,value:total,covered,total:(MEMBERS[name]||[]).length}});const complete=vals.filter(x=>x.covered===x.total);complete.sort((a,b)=>b.value-a.value);const ranks={};complete.forEach((x,i)=>ranks[x.name]=i+1);rankByDate[date]={ranks,complete:complete.length,total:CATEGORIES.length}}
let old={days:[]};try{old=JSON.parse(await fs.readFile('public/rank-history.json','utf8'))}catch{}
const dayMap=new Map((old.days||[]).map(x=>[x.date,x]));for(const date of dates){const r=rankByDate[date];if(r)dayMap.set(date,{date,ranks:r.ranks,complete:r.complete,total:r.total})}
const days=[...dayMap.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-10);
const latest=days.at(-1)?.date||null,prevValues={};if(latest)for(const name of CATEGORIES){let value=0,covered=0;for(const c of new Set(MEMBERS[name]||[])){const x=(j.values[c]||[]).find(r=>r.date===latest);if(x?.value!=null){value+=x.value;covered++}}if(covered===(MEMBERS[name]||[]).length)prevValues[name]=value}
const out={version:1,generatedAt:new Date().toISOString(),latestDate:latest,days,prevValues,source:'TWSE/TPEx official turnover; missing turnover falls back to volume × close'};
await fs.writeFile('public/rank-history.json',JSON.stringify(out));console.log(`saved ${days.length} days, latest ${latest}, ${Object.keys(prevValues).length} complete sectors`);