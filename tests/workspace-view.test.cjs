const {test}=require('node:test'),assert=require('node:assert/strict');
const view=require('../workspace-view.js'),rsi=require('../rsi-mtf.js');
const frames=(value,previous=value)=>Object.fromEntries(rsi.FRAMES.map(f=>[f.tf,{confirmed:value,previous,ready:true,healthy:true}]));
test('RSI context can light LONG/SHORT while v4.1 confirmation stays WAIT',()=>{
  for(const [value,side] of [[60,'LONG'],[40,'SHORT']]){
    const result=rsi.evaluate(frames(value)),before=JSON.stringify(result),display=view.bias(result);
    assert.equal(result.signal,'WAIT');assert.equal(result.winner,null);assert.equal(display.side,side);assert.equal(display.confirmed,false);assert.equal(display.label,'Thiên '+side);assert.equal(JSON.stringify(result),before);
  }
  assert.equal(view.bias(rsi.evaluate(frames(50))).side,null);
});
test('confirmed direction takes precedence; stale, missing and conflicting data never light a side',()=>{
  const result={score:-20,winner:{side:'LONG'},missing:[],conflict:false};assert.equal(view.bias(result).label,'LONG xác nhận');
  assert.equal(view.bias(result,true).side,null);assert.equal(view.bias({...result,missing:['1M']}).side,null);assert.equal(view.bias({...result,conflict:true}).side,null);
});
test('sparklines use only measured prices, represent flat prices and break gaps rather than fabricate history',()=>{
  assert.equal(view.sparkline([]),'');assert.equal(view.sparkline([{time:1,price:100}]),'');
  assert.equal(view.sparkline([{time:1,price:100},{time:900001,price:100}]),'M2.0,17.0 L98.0,17.0');
  const path=view.sparkline([{time:1,price:100},{time:900001,price:110},{time:3600001,price:105}]);assert.equal((path.match(/M/g)||[]).length,2);assert.equal((path.match(/L/g)||[]).length,1);assert.ok(!path.includes('NaN'));
  assert.equal(view.sparkline([{time:1,price:NaN},{time:2,price:0}]),'');
});
test('coin labels/icons are bundled locally and unknown assets have a safe fallback',()=>{
  assert.equal(view.coin('BTCUSDT').name,'Bitcoin');assert.equal(view.coin('ETHUSDT').name,'Ethereum');assert.equal(view.coin('BNBUSDT').name,'BNB');assert.equal(view.coin('NEWUSDT').name,'NEW');
  for(const symbol of ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','NEWUSDT']){assert.ok(view.icon(symbol).startsWith('<svg'));assert.ok(!/https?:|<image/.test(view.icon(symbol)))}
});
