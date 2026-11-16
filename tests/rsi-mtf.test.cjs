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
test('screenshot has -50 bias, without short confirmation',()=>{
  const out=rsi.evaluate(snapshot([50.3,24.3,32.2,49.5,47.8]));
  assert.equal(out.score,-50);assert.equal(out.signal,'WATCH SHORT');
});
test('confirmed short requires both higher frames and a fresh 15m crossing',()=>{
  assert.equal(rsi.evaluate(snapshot([50,40,40,40,44],46)).signal,'SHORT');
  assert.equal(rsi.evaluate(snapshot([50,40,40,40,44],44)).signal,'WATCH SHORT');
  assert.equal(rsi.evaluate(snapshot([40,40,40,49,44],46)).signal,'WATCH SHORT');
});
test('long confirmation is symmetric, inclusive at 55/45',()=>{
  assert.equal(rsi.evaluate(snapshot([50,60,55,55,55],54)).signal,'LONG');
  assert.equal(rsi.evaluate(snapshot([50,40,45,45,45],46)).signal,'SHORT');
  assert.equal(rsi.classify(54.999),0);assert.equal(rsi.classify(45.001),0);
});
test('all neutral and mixed frames can wait; month alone cannot trigger',()=>{
  assert.equal(rsi.evaluate(snapshot([50,50,50,50,50])).signal,'WAIT');
  assert.equal(rsi.evaluate(snapshot([60,50,50,50,50])).score,10);
  assert.equal(rsi.evaluate(snapshot([60,60,60,40,40])).signal,'WAIT');
});
test('±35 score boundary; score is bounded by ±100',()=>{
  assert.equal(rsi.evaluate(snapshot([60,50,50,60,50])).signal,'WATCH LONG');
  assert.equal(rsi.evaluate(snapshot([40,50,50,40,50])).signal,'WATCH SHORT');
  assert.equal(rsi.evaluate(snapshot([60,60,60,60,60])).score,100);
  assert.equal(rsi.evaluate(snapshot([40,40,40,40,40])).score,-100);
});
test('missing/short-history/corrupt frames block the whole score, no reweighting',()=>{
  for(const property of ['ready','healthy']){
    const input=snapshot([60,60,60,60,60]);input['1M'][property]=false;
    const out=rsi.evaluate(input);assert.equal(out.score,null);assert.equal(out.signal,'WAIT');assert.deepEqual(out.missing,['1M']);
  }
  const input=snapshot([60,60,60,60,60]);delete input['1M'];
  assert.equal(rsi.evaluate(input).score,null);
});
test('unfinished candle only changes live display, not closed decision',()=>{
  const candles=Array.from({length:16},(_,i)=>({close:100+i,closeTime:i*1000}));
  candles.push({close:1,closeTime:20000});
  const a=rsi.frame(candles,16000);assert.equal(a.confirmed,100);assert.ok(a.live<50);assert.equal(a.ready,true);
  candles.at(-1).close=200;
  const b=rsi.frame(candles,16000);assert.equal(b.confirmed,a.confirmed);assert.equal(b.previous,a.previous);assert.equal(b.live,100);
  assert.equal(rsi.frame(candles.slice(0,15),16000).ready,false);
});
