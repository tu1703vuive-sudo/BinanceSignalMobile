const {test}=require('node:test');
const assert=require('node:assert/strict');
const rsi=require('../rsi-mtf.js');

function snapshot(values,previous=50){
  return Object.fromEntries(rsi.FRAMES.map((f,i)=>[f.tf,{confirmed:values[i],previous:f.tf==='15m'?previous:values[i],ready:true,healthy:true}]));
}
test('reference Wilder smoothing and flat/one-way markets',()=>{
  const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46,46.03,46.41,46.22,45.64,46.21];
  const values=rsi.series(closes);
  assert.ok(Math.abs(values[14]-70.464135)<.00001);
  assert.ok(Math.abs(values[15]-66.249619)<.00001);
  assert.equal(rsi.series(Array(20).fill(100)).at(-1),50);
  assert.equal(rsi.series(Array.from({length:20},(_,i)=>i)).at(-1),100);
  assert.equal(rsi.series(Array.from({length:20},(_,i)=>20-i)).at(-1),0);
});
function frames(current={},previous={}){
 const c={'1M':60,'1d':58,'4h':62,'1h':61,'15m':54,...current},p={'1M':59,'1d':57,'4h':61,'1h':58,'15m':48,...previous};
 return Object.fromEntries(rsi.FRAMES.map(f=>[f.tf,{confirmed:c[f.tf],previous:p[f.tf],ready:true,healthy:true}]));
}
test('all six v4.1 strategy/side entry examples match original rules',()=>{
 const examples=[['MOMENTUM','LONG',{},{}],['MOMENTUM','SHORT',{'1M':35,'1d':43,'4h':40,'1h':41,'15m':47},{'1h':44,'15m':54}],['REVERSAL','LONG',{'1M':38,'1d':39,'4h':43,'1h':39,'15m':33},{'1h':35,'15m':26}],['REVERSAL','SHORT',{'1M':62,'1d':62,'4h':59,'1h':59,'15m':66},{'1h':62,'15m':74}],['BREAKOUT','LONG',{'15m':75},{'15m':68}],['BREAKOUT','SHORT',{'1M':37,'1d':40,'4h':34,'1h':35,'15m':26},{'1h':38,'15m':33}]];
 for(const [strategy,side,c,p] of examples){const r=rsi.evaluate(frames(c,p));assert.equal(r.signal,side,strategy);assert.equal(r.winner.strategy,strategy);assert.equal(r.winner.passed,5);assert.equal(r.winner.checks.every(c=>c.passed),true)}
});
test('v4.1 monthly context boundary is <45 bearish, exactly 45 neutral',()=>{
 assert.equal(rsi.classify(45),0);assert.equal(rsi.classify(44.999),-1);assert.equal(rsi.classify(55),1);
 const a=rsi.evaluateSide(frames({'1M':38,'1d':39,'4h':43,'1h':39,'15m':33},{'1h':35,'15m':26}),'REVERSAL','LONG');assert.equal(a.allowed,true);assert.equal(a.riskPct,.15);
 assert.equal(rsi.evaluateSide(frames({'1M':61,'1d':52}),'MOMENTUM','LONG').riskPct,.3);
});
test('entry uses exact v4.1 cross, trend and overshoot filters rather than old score gate',()=>{
 assert.equal(rsi.evaluate(frames({'15m':55},{'15m':53})).signal,'WAIT','no fresh crossing of 50');
 assert.equal(rsi.evaluate(frames({'15m':66})).signal,'WAIT','momentum overshoot >65');
 assert.equal(rsi.evaluate(frames({'1h':61},{'1h':61})).signal,'WAIT','flat 1H must not count as rising');
 const f=frames({'1M':38,'1d':44,'15m':54});const result=rsi.evaluate(f);assert.equal(result.signal,'WAIT');assert.equal(result.evaluations.MOMENTUM.LONG.checks.at(-1).passed,false,'both day/month bearish veto momentum');
 assert.equal(rsi.evaluateSide(frames({'15m':85},{'15m':69}),'BREAKOUT','LONG').allowed,true);
 assert.equal(rsi.evaluateSide(frames({'15m':85.001},{'15m':69}),'BREAKOUT','LONG').allowed,false);
});
test('one winner by fixed priority; opposite directions always wait',()=>{
 const a=rsi.arbitrate([{strategy:'MOMENTUM',side:'LONG'},{strategy:'REVERSAL',side:'LONG'},{strategy:'BREAKOUT',side:'LONG'}]);assert.equal(a.winner.strategy,'BREAKOUT');assert.equal(a.conflict,false);
 assert.deepEqual(rsi.arbitrate([{strategy:'REVERSAL',side:'LONG'},{strategy:'BREAKOUT',side:'SHORT'}]),{winner:null,conflict:true});
});
test('missing, unhealthy or invalid RSI blocks all strategies without reweighting',()=>{
 for(const property of ['ready','healthy']){const f=frames();f['1M'][property]=false;const out=rsi.evaluate(f);assert.equal(out.score,null);assert.equal(out.signal,'WAIT');assert.deepEqual(out.missing,['1M'])}
 const f=frames();delete f['1M'];assert.equal(rsi.evaluate(f).signal,'WAIT');
});
test('closed candle warmup matches source: 100 candles, monthly 30; live candle never enters',()=>{
 const cs=Array.from({length:100},(_,i)=>({close:100+i,closeTime:i*1000}));cs.push({close:1,closeTime:200000});
 const a=rsi.frame(cs,100000,'15m');assert.equal(a.confirmed,100);assert.equal(a.ready,true);assert.ok(a.live<50);
 cs.at(-1).close=300;const b=rsi.frame(cs,100000,'15m');assert.equal(b.confirmed,a.confirmed);assert.equal(b.previous,a.previous);assert.equal(b.live,100);
 assert.equal(rsi.frame(cs.slice(0,99),100000,'15m').ready,false);assert.equal(rsi.frame(cs.slice(0,29),100000,'1M').ready,false);assert.equal(rsi.frame(cs.slice(0,30),100000,'1M').ready,true);
});
