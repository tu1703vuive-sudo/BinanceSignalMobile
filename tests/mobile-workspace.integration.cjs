const assert=require('node:assert/strict');
const {harness,until,sleep}=require('./futures-app.integration.cjs');
(async()=>{
  const h=harness();try{
    await until(()=>h.el('rsiMtfScore').textContent.includes('/ 100')&&!h.el('refreshBtn').disabled);
    await h.read('refreshWatchSparklines()');await sleep(170);
    assert.ok(h.el('appSettings').contains(h.el('advancedPanel')));assert.ok(!h.w.document.querySelector('main').contains(h.el('advancedPanel')));
    const items=[...h.el('watchList').children];assert.equal(items.length,3);
    for(const item of items){assert.ok(item.querySelector('.wi-icon svg'));assert.ok(item.querySelector('.wi-name').textContent);assert.ok(item.querySelector('.wi-spark path').getAttribute('d').includes('L'));assert.ok(item.querySelector('.wi-quote .wi-price'))}
    const first=items[0],firstButton=first.querySelector('.wi-select'),before=h.requests.length;
    await h.read('refreshWatchSparklines()');assert.equal(h.requests.length,before,'cached graphs create no additional REST');
    h.read("updateWatchSpark('SOLUSDT',530,Date.now());renderWatchlist()");assert.equal(h.el('watchList').firstElementChild,first);assert.equal(first.querySelector('.wi-select'),firstButton,'ticker updates preserve focus/row DOM');
    const selected=h.read('state.selected');
    function seed(side){
      for(const tf of ['1M','1d','4h','1h','15m']){
        const rows=h.read(`getCachedCandles('${selected}','${tf}').map((c,i)=>{const p=${side==='LONG'?'100+i':'1000-i'};return {...c,open:p-.2,high:p+1,low:p-1,close:p}})`);
        h.read(`setCachedCandles('${selected}','${tf}',${JSON.stringify(rows)})`);
      }
      h.read('renderRsiMtf()');
    }
    seed('LONG');assert.equal(h.el('rsiInsightBias').textContent,'Thiên LONG');assert.equal(h.el('rsiInsightBias').dataset.confirmed,'false');assert.ok(h.el('rsiMtfLong').classList.contains('active'));assert.ok(!h.el('rsiMtfShort').classList.contains('active'));
    assert.ok(h.el('rsiMtfSignal').textContent.includes('CHỜ XÁC NHẬN'));
    const rules=h.el('rsiV41Rules');assert.equal(rules.children.length,6);assert.ok(h.el('rsiInsights').contains(rules));assert.ok(!rules.closest('.rsi-mtf-details'));
    const reversal=rules.querySelector('[data-rule="REVERSAL-LONG"]');reversal.querySelector('summary').click();assert.equal(reversal.open,true);assert.equal(reversal.querySelectorAll('.rule-checks li').length,5);
    seed('SHORT');assert.equal(h.el('rsiInsightBias').textContent,'Thiên SHORT');assert.ok(h.el('rsiMtfShort').classList.contains('active'));assert.equal(rules.querySelector('[data-rule="REVERSAL-LONG"]').open,true,'expanded rule survives updates');
    for(const card of rules.children){assert.ok(Number.isInteger(Number(card.querySelector('.rule-score strong').textContent)));assert.equal(card.querySelector('.rule-score>span').textContent,'/5')}
    h.setClock(h.clock()+91000);h.read('renderRsiMtf()');assert.equal(h.el('rsiInsightBias').dataset.tone,'wait');assert.equal(h.w.document.querySelectorAll('.rsi-mtf-directions .active').length,0);
    for(const score of rules.querySelectorAll('.rule-score strong'))assert.equal(score.textContent,'—');
    assert.deepEqual(h.errors,[]);
    console.log('PASS: reference-style dark list, true cached sparklines, advanced settings, observational LONG/SHORT, six readable rule dropdowns, five checks, expansion persistence and stale guards');
  }finally{h.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
