const assert=require('node:assert/strict');
const {harness,until}=require('./paper-app.integration.cjs');
(async()=>{
 const h=harness();
 try{
  await until(()=>h.el('rsiMtfScore').textContent.includes('/ 100'));
  await h.read("selectSymbol('ETHUSDT')");await h.read("removeSymbol('BTCUSDT')");
  assert.ok(h.read('state.ws.url').includes('btcusdt@miniTicker'),'BTC ticker remains subscribed after removal');
  for(const tf of ['1M','1d','4h','1h','15m'])assert.ok(h.read('state.klineWs.url').includes('btcusdt@kline_'+tf));
  h.newSignal('ETHUSDT');await new Promise(r=>setTimeout(r,40));assert.equal(h.ledger(),null,'fresh ETH signal cannot create a paper ledger');assert.equal(h.read('state.selected'),'ETHUSDT');assert.ok(h.el('paperTarget').textContent.includes('Chỉ BTCUSDT'));
  h.newSignal('BTCUSDT');await until(()=>!!h.ledger()?.open);assert.equal(h.ledger().open.symbol,'BTCUSDT');assert.equal(h.read('state.selected'),'ETHUSDT','BTC auto never moves the displayed chart');assert.equal(h.el('rsiMtfSymbol').textContent,'ETHUSDT');
  // The combined kline socket must accept BTC while ETH is on screen, and TP closes BTC.
  const t=h.ledger().open;h.setClock(h.getClock()+1000);const n=Math.floor(h.getClock()/900000)*900000;
  h.read(`state.klineWs.onmessage({data:JSON.stringify({s:'BTCUSDT',E:${h.getClock()},k:{i:'15m',t:${n},T:${n+899999},o:'100',h:'110',l:'99',c:'${t.tp+1}',v:'1000',x:false}})})`);
  await until(()=>h.ledger()?.trades.length===1);assert.equal(h.ledger().trades[0].reason,'TP');assert.equal(h.read('state.selected'),'ETHUSDT');assert.deepEqual(h.errors,[]);
  console.log('PASS: altcoin signals blocked, BTC stays subscribed and trades/closes while ETH chart is selected and BTC removed from watchlist');
 }finally{h.close()}
})().catch(e=>{console.error(e);process.exit(1)});
