// Independent oracle: original, unchanged Python strategy supplied by the user.
const assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process'),rsi=require('../rsi-mtf.js');
let seed=4171703;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
const edges=[0,14.999,15,24.999,25,29.999,30,31.999,32,34.999,35,39.999,40,44.999,45,47.999,48,49.999,50,51.999,52,54.999,55,59.999,60,64.999,65,67.999,68,69.999,70,74.999,75,84.999,85,100];
const cases=[];
for(let i=0;i<4000;i++){
 const r={},p={};for(const f of rsi.FRAMES){r[f.tf]=i%2?edges[Math.floor(random()*edges.length)]:random()*100;p[f.tf]=i%3?edges[Math.floor(random()*edges.length)]:random()*100}cases.push({r,p});
}
// Include every exact boundary in each current/previous slot with ordinary contexts.
for(const f of rsi.FRAMES)for(const value of edges)for(const previous of [false,true]){
 const r={'1M':60,'1d':58,'4h':62,'1h':61,'15m':54},p={'1M':59,'1d':57,'4h':61,'1h':58,'15m':48};(previous?p:r)[f.tf]=value;cases.push({r,p});
}
const closes=Array.from({length:12},(_,n)=>Array.from({length:450},(_,i)=>n===0?100:n===1?100+i:n===2?600-i:100+Math.sin(i/7)*15+random()));
const py=String.raw`
import sys,json,importlib.util
spec=importlib.util.spec_from_file_location('reference',sys.argv[1]);ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
data=json.load(sys.stdin);out=[]
for case in data['cases']:
 series={tf:[{'rsi':case['p'][tf],'open_ms':0,'close_ms':999,'close':100},{'rsi':case['r'][tf],'open_ms':1000,'close_ms':1999,'close':100}] for tf in ref.FRAMES}
 es=[ref.evaluate(series,st,side) for st in ref.STRATEGIES for side in ('LONG','SHORT')]
 winner,conflict=ref.arbitrate([e for e in es if e['allowed']])
 out.append({'evaluations':[{'allowed':e['allowed'],'passed':e['passed'],'checks':[c['passed'] for c in e['checks']],'riskPct':e['risk_pct'],'context':e['context']} for e in es],'winner':({'strategy':winner['strategy'],'side':winner['side']} if winner else None),'conflict':conflict})
print(json.dumps({'cases':out,'series':[ref.rsi_wilder(c) for c in data['closes']]}))
`;
const reference=path.join(__dirname,'reference','v41_strategy.py');
const result=spawnSync(process.env.PYTHON||'python3',['-c',py,reference],{input:JSON.stringify({cases,closes}),encoding:'utf8',maxBuffer:32*1024*1024});
assert.equal(result.status,0,result.stderr||result.error?.message);const expected=JSON.parse(result.stdout);
for(let i=0;i<cases.length;i++){
 const {r,p}=cases[i],frames=Object.fromEntries(rsi.FRAMES.map(f=>[f.tf,{confirmed:r[f.tf],previous:p[f.tf],ready:true,healthy:true}])),a=rsi.evaluate(frames);
 const actual={evaluations:rsi.STRATEGIES.flatMap(st=>['LONG','SHORT'].map(side=>{const e=a.evaluations[st][side];return {allowed:e.allowed,passed:e.passed,checks:e.checks.map(c=>c.passed),riskPct:e.riskPct,context:e.context}})),winner:a.winner?{strategy:a.winner.strategy,side:a.winner.side}:null,conflict:a.conflict};
 assert.deepEqual(actual,expected.cases[i],'Python parity case '+i);
}
for(let n=0;n<closes.length;n++)rsi.series(closes[n]).forEach((v,i)=>{const e=expected.series[n][i];if(e===null)assert.equal(v,null);else assert.ok(Math.abs(v-e)<1e-10,`RSI ${n}/${i}`)});
console.log(`PASS: ${cases.length} snapshots × 6 strategy/side evaluations, all individual checks/risk/context/winner; ${closes.length} × 450 Wilder RSI values match original Python.`);
