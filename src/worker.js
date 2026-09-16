const TWSE_CLOSE='https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_CLOSE='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const TPEX_ALL='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';
const CORS={'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'Content-Type'};
const n=v=>{if(v==null)return null;const s=String(v).trim();if(!s||s==='-'||s==='--')return null;const x=Number(s.replaceAll(',','').replace(/[^\d.-]/g,''));return Number.isFinite(x)?x:null};
const pick=(o,ks)=>{for(const k of ks)if(o?.[k]!=null&&o[k]!=='')return o[k];return null};
async function jf(url){const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json,text/plain,*/*','cache-control':'no-cache'},cf:{cacheTtl:0,cacheEverything:false}});if(!r.ok)throw Error(`${r.status} ${url}`);return r.json()}
function json(data,cache='public, max-age=15'){return new Response(JSON.stringify(data),{headers:{...CORS,'content-type':'application/json; charset=utf-8','cache-control':cache}})}
function normDate(v){const s=String(v||'').replace(/[^0-9]/g,'');if(s.length===8)return s;if(s.length===7){const y=Number(s.slice(0,3))+1911;return String(y)+s.slice(3)}return s}
function parseClose(o,market){const code=String(pick(o,['Code','SecuritiesCompanyCode'])||'').trim();if(!/^\d{4}$/.test(code))return null;return{code,name:String(pick(o,['Name','CompanyName','SecuritiesCompanyName'])||code).trim(),close:n(pick(o,['ClosingPrice','Close','ClosePrice'])),change:n(pick(o,['Change','ChangeAmount'])),value:n(pick(o,['TradeValue','TransactionAmount','TransactionValue','Amount'])),date:normDate(pick(o,['Date','TradeDate'])),market,source:'最近收盤'}}
function tw(){return new Date(Date.now()+8*3600e3)}
function mins(){const d=tw();return d.getUTCHours()*60+d.getUTCMinutes()}
function weekday(){const d=tw(),day=d.getUTCDay();return day>=1&&day<=5}
function marketOpen(){const m=mins();return weekday()&&m>=540&&m<=810}
function useMis(){const m=mins();return weekday()&&m>=525&&m<=1200}
function today8(){const d=tw();return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`}
async function quotes(url){
 const [a,b]=await Promise.allSettled([jf(TWSE_CLOSE),jf(TPEX_CLOSE)]),out={};
 if(a.status==='fulfilled')for(const o of a.value){const q=parseClose(o,'tse');if(q)out[q.code]=q}
 if(b.status==='fulfilled')for(const o of b.value){const q=parseClose(o,'otc');if(q)out[q.code]=q}
 let requested=[...new Set((url?.searchParams.get('codes')||'').split(',').map(x=>x.trim()).filter(x=>/^\d{4}$/.test(x)))];
 if(!requested.length)requested=Object.keys(out);
 requested=requested.filter(c=>out[c]);
 let misRows=0,misToday=0,misErrors=0;
 if(useMis()){
  const today=today8(),batches=[];
  for(let i=0;i<requested.length;i+=80)batches.push(requested.slice(i,i+80));
  for(let w=0;w<batches.length;w+=6){
   const jobs=batches.slice(w,w+6).map(async batch=>{
    const ex=batch.map(c=>`${out[c].market}_${c}.tw`).join('|');
    const u='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+encodeURIComponent(ex)+'&json=1&delay=0&_='+Date.now()+Math.random();
    return jf(u);
   });
   const results=await Promise.allSettled(jobs);
   for(const rr of results){
    if(rr.status!=='fulfilled'){misErrors++;continue}
    for(const x of rr.value.msgArray||[]){
     misRows++;
     const code=String(x.c||'').trim();if(!out[code])continue;
     const liveDate=normDate(x.d),p=n(x.z)??n(x.trade?.z)??n(x.pz),y=n(x.y),v=n(x.v);
     if(liveDate===today&&(p!=null||v!=null)){
      misToday++;
      out[code]={...out[code],close:p??out[code].close,change:p!=null&&y!=null?p-y:out[code].change,value:v!=null&&p!=null?v*1000*p:out[code].value,date:liveDate,source:marketOpen()?'盤中':'今日收盤',time:x.trade?.t||x.t||'',debug:{z:x.z??null,tradeZ:x.trade?.z??null,pz:x.pz??null,d:x.d??null,t:x.t??null}};
     }
    }
   }
  }
 }
 return json({ok:true,updated:new Date().toISOString(),marketOpen:marketOpen(),today:today8(),mis:{requested:requested.length,rows:misRows,today:misToday,errors:misErrors},quotes:out},useMis()?'no-store':'public, max-age=300');
}
function date8(v){const p=String(v||'').trim().split('/');if(p.length!==3)return null;let y=Number(p[0]);if(y<1911)y+=1911;return `${y}${p[1].padStart(2,'0')}${p[2].padStart(2,'0')}`}
function months(){const d=tw(),y=d.getUTCFullYear(),m=d.getUTCMonth()+1,prev=new Date(Date.UTC(y,m-2,1));return[`${prev.getUTCFullYear()}${String(prev.getUTCMonth()+1).padStart(2,'0')}01`,`${y}${String(m).padStart(2,'0')}01`]}
async function twseHist(code){let all=[];for(const date of months()){try{const j=await jf(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=${code}&response=json`);if(j.stat==='OK')all.push(...j.data.map(r=>({date:date8(r[0]),value:n(r[2]),market:'tse'})))}catch{}}return all.filter(x=>x.date&&x.value!=null).sort((a,b)=>a.date.localeCompare(b.date)).slice(-12)}
async function tpexHist(code){const d=tw(),dates=[new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)),d],all=[];for(const z of dates){const date=`${z.getUTCFullYear()}/${String(z.getUTCMonth()+1).padStart(2,'0')}/01`;try{const j=await jf(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${date}&id=&response=json`);for(const r of (j.tables||[]).flatMap(t=>t.data||[])){const v=n(r[2]);if(v!=null)all.push({date:date8(r[0]),value:v*1000,market:'otc'})}}catch{}}return all.filter(x=>x.date&&x.value!=null).sort((a,b)=>a.date.localeCompare(b.date)).slice(-12)}
async function history(url){const codes=[...new Set((url.searchParams.get('codes')||'').split(',').filter(x=>/^\d{4}$/.test(x)))].slice(0,80);const [ta,oa]=await Promise.all([jf(TWSE_CLOSE),jf(TPEX_ALL)]),tse=new Set((ta||[]).map(x=>String(x.Code||'').trim())),otc=new Set((oa||[]).map(x=>String(x.SecuritiesCompanyCode||'').trim())),values={};for(let i=0;i<codes.length;i+=20)await Promise.all(codes.slice(i,i+20).map(async c=>{try{values[c]=tse.has(c)?await twseHist(c):otc.has(c)?await tpexHist(c):[]}catch{values[c]=[]}}));return json({ok:true,unit:'TWD',values},'public, max-age=43200')}
async function cached(request,ttl,fn){const cache=caches.default,u=new URL(request.url);u.searchParams.delete('t');u.searchParams.delete('_');const key=new Request(u.toString(),{method:'GET'}),hit=await cache.match(key);if(hit)return hit;const r=await fn();if(r.ok){const h=new Headers(r.headers);h.set('cache-control',`public, max-age=${ttl}`);const c=new Response(r.body,{status:r.status,headers:h});await cache.put(key,c.clone());return c}return r}
export default{async fetch(request,env){if(request.method==='OPTIONS')return new Response(null,{headers:CORS});const u=new URL(request.url);try{if(u.pathname==='/api/quotes')return useMis()?await quotes(u):await cached(request,300,()=>quotes(u));if(u.pathname==='/api/history')return await cached(request,43200,()=>history(u));return env.ASSETS.fetch(request)}catch(e){return json({ok:false,error:String(e)},'no-store')}}};