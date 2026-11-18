// Presentation only. Does not change RSI evaluation or confirmation rules.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkspaceView=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const COINS={BTC:['Bitcoin','#f7931a'],ETH:['Ethereum','#7886ee'],BNB:['BNB','#efb90b'],SOL:['Solana','#7660d4'],XRP:['XRP','#50627b'],DOGE:['Dogecoin','#b6a354'],ADA:['Cardano','#286bcc'],AVAX:['Avalanche','#e64c5b'],LINK:['Chainlink','#416bd3'],DOT:['Polkadot','#d74287'],TRX:['TRON','#d83748'],LTC:['Litecoin','#4673c6'],SUI:['Sui','#579de2'],TON:['Toncoin','#2294cf'],NEAR:['NEAR Protocol','#568c83'],APT:['Aptos','#4d9e9d'],UNI:['Uniswap','#ce6192'],BCH:['Bitcoin Cash','#47ac7e'],ENA:['Ethena','#59677e']};
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function coin(symbol){const base=symbol.replace(/USDT$/,''),known=COINS[base];return {base,name:known?.[0]||base,color:known?.[1]||'#4b667f'}}
  function icon(symbol){
    const {base,color}=coin(symbol);
    const shape=base==='BTC'?'<text x="18" y="25" text-anchor="middle" font-size="26" font-family="Arial,sans-serif" font-weight="700" fill="white" transform="rotate(12 18 18)">₿</text>':base==='ETH'?'<path d="m18 5-8 13 8 4 8-4z" fill="white" fill-opacity=".88"/><path d="m10 20 8 11 8-11-8 5z" fill="white" fill-opacity=".65"/><path d="M18 5v17l8-4z" fill="#c7cdf8"/>':base==='BNB'?'<g fill="white"><path d="m18 6 5 5-3 3-2-2-2 2-3-3zM10 14l4 4-4 4-4-4zM26 14l4 4-4 4-4-4zM18 16l2 2-2 2-2-2zM13 25l3-3 2 2 2-2 3 3-5 5z"/></g>':base==='SOL'?'<g fill="white"><path d="M10 10h19l-4 4H6zM10 16h15l4 4H14zM10 22h19l-4 4H6z"/></g>':`<text x="18" y="24" text-anchor="middle" font-size="19" font-family="Arial,sans-serif" font-weight="700" fill="white">${escape(base[0]||'?')}</text>`;
    return `<svg viewBox="0 0 36 36" aria-hidden="true" focusable="false"><circle cx="18" cy="18" r="18" fill="${color}"/>${shape}</svg>`;
  }
  function sparkline(points,{width=100,height=34}={}){
    const clean=points.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.price)&&p.price>0).slice(-97);
    if(clean.length<2)return '';
    const lo=Math.min(...clean.map(p=>p.price)),hi=Math.max(...clean.map(p=>p.price)),span=clean.at(-1).time-clean[0].time;
    if(span<=0)return '';
    return clean.map((p,i)=>{const x=2+(p.time-clean[0].time)/span*(width-4),y=hi===lo?height/2:3+(hi-p.price)/(hi-lo)*(height-6),gap=i&&p.time-clean[i-1].time>900000;return `${i&&!gap?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`}).join(' ');
  }
  function bias(result,blocked=false){
    if(blocked||result.missing?.length)return {side:null,tone:'wait',label:'Chờ dữ liệu',confirmed:false};
    if(result.conflict)return {side:null,tone:'wait',label:'Mâu thuẫn · chờ',confirmed:false};
    const side=result.winner?.side||(result.score>0?'LONG':result.score<0?'SHORT':null),confirmed=!!result.winner;
    return {side,tone:side==='LONG'?'long':side==='SHORT'?'short':'wait',label:side?(confirmed?`${side} xác nhận`:`Thiên ${side}`):'Trung lập',confirmed};
  }
  return Object.freeze({coin,icon,sparkline,bias});
});
