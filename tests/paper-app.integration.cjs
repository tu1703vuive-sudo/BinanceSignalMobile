/* Optional integration checks: npm install --no-save jsdom; node tests/paper-app.integration.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const core=require('../paper-trading.js');
const root=path.resolve(__dirname,'..'),KEY='bsm_paper_rsi_v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(10)}throw new Error('Timed out: '+fn.toString())}
const shared=()=>{const map=new Map();let queue=Promise.resolve();return {map,storage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)},locks:{request:(_name,fn)=>{const result=queue.then(()=>fn({name:_name}));queue=result.catch(()=>{});return result}}}}
function harness({store=shared(),start=Date.UTC(2026,10,16,8,0,1),recovery='safe',locks=true,seed=null}={}){
  if(seed)store.storage.setItem(KEY,JSON.stringify(seed));
  const errors=[],notes=[],requests=[],downloads=[],v=new VirtualConsole();v.on('jsdomError',e=>errors.push(String(e)));
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://test.invalid/',virtualConsole:v}),w=dom.window;
  let clock=start;
  Object.defineProperty(w,'localStorage',{value:store.storage});if(locks)Object.defineProperty(w.navigator,'locks',{value:store.locks});
  w.Date.now=()=>clock;w.AbortController=AbortController;w.confirm=()=>true;
  w.URL.createObjectURL=blob=>{assert.ok(blob.size>0);return 'blob:test'};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
  class Notification {static permission='default';static async requestPermission(){Notification.permission='granted';return 'granted'}constructor(title,opts){notes.push({title,...opts})}}
  w.Notification=Notification;
  Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistration:async()=>({showNotification:async(title,opts)=>notes.push({title,...opts})})}});
  const ctx=new Proxy({measureText:s=>({width:String(s).length*6}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx;
  function rows(tf,startTime){
    if(tf==='1m'){
      if(recovery==='gap')return [];
      const book=JSON.parse(store.storage.getItem(KEY)),t=book.open,out=[];
      const end=Math.floor(clock/60000)*60000;
      for(let n=startTime;n<end&&out.length<1000;n+=60000){
        const hit=recovery==='both'&&n>t.entryAt;
        const o=t.entry,c=o+.01,high=hit?t.tp+1:o+.1,low=hit?t.sl-1:o-.1;
        out.push([n,''+o,''+high,''+low,''+c,'1000',n+59999]);
      }return out;
    }
    const step={'15m':900000,'1h':3600000,'4h':14400000,'12h':43200000,'1d':86400000,'1w':604800000}[tf];
    const d=new Date(clock),current=tf==='1M'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):Math.floor(clock/step)*step;
    const month=(ms,offset)=>{let d=new Date(ms);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,1)};
    return Array.from({length:260},(_,i)=>{
      const t=tf==='1M'?month(current,i-259):current+(i-259)*step,end=tf==='1M'?month(t,1)-1:t+step-1;
      // RSI 15m crosses 55 on the last CLOSED candle; other four frames are bullish.
      const c=tf==='15m'?(i<258?100+(i%2):i===258?105:105.2):100+i*.1,o=c-.05;
      return [t,''+o,''+(c+.2),''+(o-.2),''+c,'1000',end];
    });
  }
  w.fetch=async url=>{const u=new URL(url);requests.push(url);if(u.pathname.endsWith('/klines'))return {ok:true,json:async()=>rows(u.searchParams.get('interval'),Number(u.searchParams.get('startTime')))};return {ok:true,json:async()=>({lastPrice:'105.2',priceChangePercent:'1'})}};
  class Socket{constructor(url){this.url=url;this.readyState=0;w.setTimeout(()=>{if(this.readyState!==3){this.readyState=1;this.onopen?.({})}},2)}close(){this.readyState=3;this.onclose?.({})}}
  w.WebSocket=Socket;w.addEventListener('error',e=>errors.push(String(e.error)));
  for(const file of ['rsi-mtf.js','paper-trading.js','paper-ui.js','app.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8')+(file==='app.js'?'\nwindow.__qaEval=(code)=>eval(code);':''));
  const read=s=>w.__qaEval(s),el=id=>w.document.getElementById(id),ledger=()=>JSON.parse(store.storage.getItem(KEY));
  function arm(){el('paperAuto').checked=true;el('paperAuto').dispatchEvent(new w.Event('change'))}
  function newSignal(){
    clock=Math.floor(clock/900000)*900000+900000+500;
    for(const tf of ['1M','1d','4h','1h','15m']){
      const cs=rows(tf).map(r=>({openTime:r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:r[6]}));
      read(`setCachedCandles(state.selected,${JSON.stringify(tf)},${JSON.stringify(cs)})`);
    }
    read(`paperUi.onQuote(state.selected,105.2,${clock});renderRsiMtf()`);
  }
  return {w,dom,read,el,ledger,store,errors,notes,requests,downloads,arm,newSignal,setClock:n=>clock=n,getClock:()=>clock,close:()=>w.close()};
}
(async()=>{
  const h=harness();await until(()=>h.el('rsiMtfScore').textContent.includes('/ 100'));
  assert.equal(h.el('paperAuto').checked,false);assert.equal(h.ledger(),null);
  assert.equal(h.el('paperEquity').textContent,'10,000.00');
  await h.el('paperNotify').onclick();await until(()=>h.notes.length===1);
  h.arm();h.read(`paperUi.onQuote(state.selected,105.2,${h.getClock()});renderRsiMtf()`);await sleep(20);
  assert.equal(h.ledger(),null,'arming does not trade an existing confirmation');
  h.newSignal();await until(()=>!!h.ledger()?.open);const t=h.ledger().open;
  assert.equal(t.side,'LONG');assert.equal(Object.keys(t.rsi).length,5);assert.equal(h.notes.length,2);
  assert.ok(h.el('paperToast').textContent.includes('Đã mở LONG BTCUSDT'));
  h.read('renderRsiMtf();renderRsiMtf()');await sleep(20);assert.equal(h.notes.length,2);
  const openBackup=JSON.parse(JSON.stringify(h.ledger()));
  // Switch away and remove the open coin: subscription must still monitor it.
  await h.read("selectSymbol('ETHUSDT')");await h.read("removeSymbol('BTCUSDT')");
  await sleep(20);assert.ok(h.read('state.ws.url').includes('btcusdt@miniTicker'));
  h.setClock(h.getClock()+1000);
  h.read(`state.ws.onmessage({data:JSON.stringify({s:'BTCUSDT',c:'${t.tp+1}',o:'100',E:${h.getClock()}})})`);
  await until(()=>h.ledger()?.trades.length===1);
  assert.equal(h.ledger().open,null);assert.equal(h.ledger().trades[0].reason,'TP');assert.ok(h.ledger().cash>10000);assert.equal(h.notes.length,3);
  assert.equal(h.el('paperHistoryCount').textContent,'1');
  h.el('paperCsv').click();h.el('paperBackup').click();assert.deepEqual(h.downloads,['BinanceSignal-Paper-History.csv','BinanceSignal-Paper-Backup.json']);
  const reload=harness({store:h.store,start:h.getClock()});await until(()=>reload.el('rsiMtfScore').textContent.includes('/ 100'));
  assert.equal(reload.el('paperAuto').checked,false);assert.equal(reload.ledger().trades.length,1);
  assert.equal(reload.el('paperHistoryCount').textContent,'1');assert.deepEqual(reload.errors,[]);reload.close();
  assert.deepEqual(h.errors,[]);h.close();
  // Reload an open order after missing minutes: catch-up resolves both-hit candles as SL.
  const r=harness({seed:openBackup,start:t.entryAt+180000,recovery:'both'});
  await until(()=>r.ledger()?.trades.length===1);assert.equal(r.ledger().trades[0].reason,'SL');assert.equal(r.ledger().trades[0].recovered,true);assert.equal(r.ledger().trades[0].ambiguous,true);
  assert.ok(r.requests.some(u=>u.includes('interval=1m')));assert.deepEqual(r.errors,[]);r.close();
  const gap=harness({seed:openBackup,start:t.entryAt+180000,recovery:'gap'});
  await until(()=>gap.el('paperStatus').textContent.includes('Chưa kiểm tra được'));
  assert.equal(gap.ledger().open.id,t.id);assert.equal(gap.ledger().trades.length,0);assert.deepEqual(gap.errors,[]);gap.close();
  // Two tabs race on one confirmation: serialized ledger + idempotent signal => one entry/notification.
  const store=shared(),a=harness({store}),b=harness({store});
  await until(()=>a.el('rsiMtfScore').textContent.includes('/ 100')&&b.el('rsiMtfScore').textContent.includes('/ 100'));
  a.arm();b.arm();a.newSignal();b.newSignal();await until(()=>!!a.ledger()?.open);await sleep(30);
  assert.equal(a.ledger().revision,1);assert.equal(a.ledger().trades.length,0);
  assert.equal(Number(a.el('paperToast').textContent.includes('Đã mở'))+Number(b.el('paperToast').textContent.includes('Đã mở')),1);
  // Manual close uses the same fresh quote and commits exactly one close.
  a.el('paperClose').click();await until(()=>a.ledger().trades.length===1);
  assert.equal(a.ledger().trades[0].reason,'MANUAL');
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);a.close();b.close();
  // Hidden tab must never open an order, even with otherwise valid new RSI.
  const hidden=harness();await until(()=>hidden.el('rsiMtfScore').textContent.includes('/ 100'));
  hidden.arm();Object.defineProperty(hidden.w.document,'visibilityState',{value:'hidden',configurable:true});hidden.newSignal();await sleep(30);
  assert.equal(hidden.ledger(),null);hidden.close();
  const quota=harness();await until(()=>quota.el('rsiMtfScore').textContent.includes('/ 100'));
  quota.arm();const original=quota.store.storage.setItem;quota.store.storage.setItem=(key,value)=>{if(key===KEY)throw new Error('QuotaExceededError');return original(key,value)};
  quota.newSignal();await until(()=>quota.el('paperStatus').textContent.includes('Không thể lưu'));
  assert.equal(quota.ledger(),null);assert.equal(quota.el('paperAuto').checked,false);assert.equal(quota.notes.length,0);quota.close();
  const unsupported=harness({locks:false});await until(()=>unsupported.el('rsiMtfScore').textContent.includes('/ 100'));
  assert.equal(unsupported.el('paperAuto').disabled,true);unsupported.close();
  console.log(JSON.stringify({passed:['default off and correct virtual capital','permission/test notification','old signal ignored on arm','new confirmed signal opens with 5-frame audit','duplicate renders do not re-enter','open coin monitored after switch/removal','TP closes with toast and OS notification','CSV and JSON download actions','history persists and auto resets on reload','1m offline catch-up with conservative SL','missing recovery candles never fabricate exit','multi-tab race creates exactly one entry','manual close and hidden-tab entry guard','storage quota blocks entry and acknowledgment','unsupported lock API disables auto'],runtime_errors:[]},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
