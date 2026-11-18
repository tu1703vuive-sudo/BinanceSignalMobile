const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(10)}throw new Error('Timed out: '+fn.toString())}
function harness(){
  const errors=[],requests=[],sockets=[],v=new VirtualConsole();v.on('jsdomError',e=>errors.push(String(e)));
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://test.invalid/',virtualConsole:v}),w=dom.window;
  let clock=Date.UTC(2026,10,18,3,0,1),failMonth=false,monthCount=90;
  w.Date.now=()=>clock;w.AbortSignal=AbortSignal;w.AbortController=AbortController;w.confirm=()=>true;w.alert=()=>{};
  w.localStorage.setItem('bsm_market','okx');w.localStorage.setItem('bsm_symbols_okx',JSON.stringify(['ETHUSDT','SOLUSDT','BTCUSDT']));w.localStorage.setItem('bsm_favorites_okx',JSON.stringify(['SOLUSDT']));w.localStorage.setItem('bsm_selected_okx','ETHUSDT');
  const oldLedger='{"preserved":true}';w.localStorage.setItem('bsm_paper_rsi_v1',oldLedger);
  const ctx=new Proxy({measureText:s=>({width:String(s).length*6}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});w.HTMLCanvasElement.prototype.getContext=()=>ctx;
  w.HTMLElement.prototype.scrollIntoView=function(){this.scrolled=true};
  function rows(tf,symbol){
    const count=tf==='1M'?monthCount:450,step={'15m':900000,'1h':3600000,'4h':14400000,'12h':43200000,'1d':86400000,'1w':604800000}[tf];
    const month=(t,n)=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)},d=new Date(clock),current=tf==='1M'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):Math.floor(clock/step)*step;
    return Array.from({length:count},(_,i)=>{const t=tf==='1M'?month(current,i-count+1):current+(i-count+1)*step,end=tf==='1M'?month(t,1)-1:t+step-1,c=500+i*.1+4*Math.sin(i*.4)+(symbol==='SOLUSDT'?10:0);return [t,''+(c-.4),''+(c+1),''+(c-1),''+c,'1000',end]});
  }
  w.fetch=async(url,options)=>{
    requests.push({url,options});const u=new URL(url);assert.equal(u.origin,'https://fapi.binance.com');assert.ok(['/fapi/v1/klines','/fapi/v1/ticker/24hr'].includes(u.pathname));assert.equal(options.method,'GET');
    const tf=u.searchParams.get('interval'),symbol=u.searchParams.get('symbol');
    if(tf){if(symbol==='SOLUSDT')await sleep(25);if(failMonth&&tf==='1M')return new Response('unavailable',{status:500});return new Response(JSON.stringify(rows(tf,symbol)))}
    return new Response(JSON.stringify({symbol,lastPrice:'520',priceChangePercent:'2.1',closeTime:clock}));
  };
  class Socket{
    constructor(url){this.url=url;this.readyState=0;sockets.push(this);w.setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.({});if(url.includes('@ticker'))for(const stream of new URL(url).searchParams.get('streams').split('/'))this.emit({e:'24hrTicker',s:stream.split('@')[0].toUpperCase(),c:'520',P:'2.1',E:clock})},2)}
    emit(data){this.onmessage?.({data:JSON.stringify({data})})}
    send(){throw new Error('Binance streams must not send OKX subscriptions or text ping')}
    close(){this.readyState=3;this.onclose?.({})}
  }
  w.WebSocket=Socket;w.addEventListener('error',e=>errors.push(String(e.error)));
  for(const file of ['futures-market.js','workspace-view.js','rsi-mtf.js','mobile-ui.js','app.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8')+(file==='app.js'?'\nwindow.__qaEval=code=>eval(code);':''));
  return {w,dom,errors,requests,sockets,oldLedger,read:code=>w.__qaEval(code),el:id=>w.document.getElementById(id),setClock:value=>clock=value,clock:()=>clock,failMonth:()=>{failMonth=true},shortMonth:()=>{monthCount=10},close:()=>w.close()};
}
module.exports={harness,until,sleep};
if(require.main===module)(async()=>{
  const h=harness();try{
    await until(()=>h.el('rsiMtfScore').textContent.includes('/ 100')&&!h.el('refreshBtn').disabled);
    assert.equal(h.read('state.market'),'futures');assert.equal(h.read('state.selected'),'ETHUSDT');
    assert.deepEqual(JSON.parse(h.w.localStorage.getItem('bsm_symbols_futures')),['ETHUSDT','SOLUSDT','BTCUSDT']);
    assert.deepEqual(JSON.parse(h.w.localStorage.getItem('bsm_favorites_futures')),['SOLUSDT']);
    assert.equal(h.w.localStorage.getItem('bsm_paper_rsi_v1'),h.oldLedger);
    assert.equal(h.w.PaperTrading,undefined);assert.equal(h.w.PaperUI,undefined);assert.equal(h.el('paperPanel'),null);
    assert.equal(h.w.document.querySelectorAll('.bottom-nav button').length,3);
    assert.equal(h.w.document.querySelectorAll('.rsi-mtf-cell').length,5);assert.equal(h.w.document.querySelector('.rsi-mtf-cell>span').textContent,'1M');
    const klines=h.requests.filter(r=>r.url.includes('/klines')&&new URL(r.url).searchParams.get('symbol')==='ETHUSDT');assert.equal(klines.length,5);assert.equal(new Set(klines.map(r=>new URL(r.url).searchParams.get('interval'))).size,5);
    for(const socket of h.sockets){const u=new URL(socket.url);assert.equal(u.origin,'wss://fstream.binance.com');assert.equal(u.pathname,'/market/stream');assert.ok(!u.search.includes('kline_1m'))}
    const score=h.el('rsiMtfScore').textContent,live=h.w.document.querySelectorAll('.rsi-mtf-cell strong')[4].textContent,ws=h.read('state.klineWs'),last=h.read("state.candles['15m'].at(-1)");
    ws.emit({e:'kline',s:'ETHUSDT',k:{s:'ETHUSDT',i:'15m',t:last.openTime,o:String(last.open),h:'10001',l:String(last.low),c:'10000',v:'1000',T:last.closeTime,x:false}});
    await sleep(420);assert.equal(h.el('rsiMtfScore').textContent,score);assert.notEqual(h.w.document.querySelectorAll('.rsi-mtf-cell strong')[4].textContent,live);
    h.setClock(h.clock()+91000);h.read('renderRsiMtf()');assert.equal(h.el('rsiMtfScore').textContent,'Điểm xu hướng --');h.setClock(h.clock()-91000);
    h.read("selectSymbol('SOLUSDT');selectSymbol('BTCUSDT')");await until(()=>!h.read('state.rsiMtfLoading')&&!h.el('refreshBtn').disabled);await sleep(60);assert.equal(h.read('state.selected'),'BTCUSDT');assert.equal(h.el('rsiMtfSymbol').textContent,'BTCUSDT');
    ws.emit({e:'kline',s:'ETHUSDT',k:{s:'ETHUSDT',i:'15m',t:last.openTime,o:String(last.open),h:'10001',l:String(last.low),c:'10000',v:'1000',T:last.closeTime,x:false}});assert.equal(h.el('rsiMtfSymbol').textContent,'BTCUSDT');
    h.read("setChartTimeframe('1M')");await until(()=>h.read('state.chartTf')==='1M');h.read("applyChartPreset('minimal')");assert.ok(h.el('rsiPanel').classList.contains('indicator-hidden'));assert.ok(!h.el('rsiMtf').classList.contains('indicator-hidden'));
    h.read("setMode('swing')");await until(()=>!h.el('refreshBtn').disabled);assert.equal(h.read('state.analysis.mode'),'DÀI HẠN');
    h.w.document.querySelector('[data-section="rsiMtf"]').click();assert.equal(h.el('rsiMtf').scrolled,true);
    h.el('appSettingsBtn').click();assert.ok(h.el('appSettings').open||h.el('appSettings').hasAttribute('open'));h.el('appSettingsClose').click();
    assert.deepEqual(h.errors,[]);
  }finally{h.close()}
  const short=harness();try{short.shortMonth();short.read("selectSymbol('BTCUSDT')");await until(()=>!short.read('state.rsiMtfLoading')&&!short.el('refreshBtn').disabled);assert.equal(short.w.document.querySelector('.rsi-mtf-cell strong').textContent,'--');assert.ok(short.el('rsiMtfReason').textContent.includes('Chưa đủ lịch sử'));assert.deepEqual(short.errors,[])}finally{short.close()}
  const failed=harness();try{await until(()=>!failed.read('state.rsiMtfLoading')&&!failed.el('refreshBtn').disabled);failed.failMonth();failed.read("analyzeSelected({forceRest:true,source:'manual'})");await until(()=>!failed.read('state.rsiMtfLoading')&&!failed.el('refreshBtn').disabled);assert.equal(failed.el('rsiMtfScore').textContent,'Điểm xu hướng --');assert.ok(failed.el('rsiMtfReason').textContent.includes('Không tải được 1M'));assert.deepEqual(failed.errors,[])}finally{failed.close()}
  console.log('PASS: Futures-only UI, five frames/monthly, deduplicated REST, live candle isolation, stale data, symbol races, chart/settings/navigation, legacy preferences, no paper/remote calls');
})().catch(e=>{console.error(e);process.exitCode=1});
