(function(root){
  'use strict';
  const KEY='bsm_paper_rsi_v1',PREFS='bsm_paper_prefs_v1',LOCK='bsm-paper-rsi-ledger-v1';
  root.PaperUI={create(adapter){
    const core=root.PaperTrading,$=id=>document.getElementById(id),panel=$('paperPanel');
    if(!panel)return null;
    let book=null,enabled=false,armedAt=Date.now(),recovering=false,recoveryError='',storageError='',message='Bật tự vào lệnh để chờ tín hiệu RSI mới.',historyCount=20;
    let selected=adapter.selected(),feedAt=0,lastSave=0,audio=null,toastTimer=null,quoteTimer=null,latestQuotes=new Map(),lastRecoveryTry=0;
    const hasLocks=typeof navigator.locks?.request==='function';
    const money=x=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}):'--';
    const price=x=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumSignificantDigits:9}):'--';
    const stamp=x=>new Date(x).toLocaleString('vi-VN');
    const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    try{book=core.restore(localStorage.getItem(KEY))}catch(e){storageError=e.message}
    let sound=false;try{sound=JSON.parse(localStorage.getItem(PREFS)||'{}').sound===true}catch{}
    const beforeSymbol=()=>book?.open?.symbol||null;
    function load(){return core.restore(localStorage.getItem(KEY))}
    function syncInputs(){if(!book)return;for(const key of Object.keys(core.DEFAULTS))$('paper-'+key).value=book.config[key];$('paper-initialCapital').disabled=!!book.open||book.trades.length>0}
    function announce(text){$('paperToast').textContent=text;$('paperToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('paperToast').hidden=true},10000)}
    async function initAudio(){
      try{const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio)return;if(!audio)audio=new Audio();if(audio.state==='suspended')await audio.resume()}catch{}
    }
    function beep(){try{if(!sound||!audio||audio.state!=='running')return;const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=880;g.gain.setValueAtTime(.08,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.3);o.start();o.stop(audio.currentTime+.3)}catch{}}
    async function systemNotification(title,body,tag){
      if(!('Notification' in root)||Notification.permission!=='granted')return;
      try{
        const reg=await navigator.serviceWorker?.getRegistration?.();
        if(reg?.showNotification)await reg.showNotification(title,{body,tag,icon:'./icons/icon-192.png',data:{url:location.href}});
        else new Notification(title,{body,tag,icon:'./icons/icon-192.png'});
      }catch{/* The in-app event and ledger remain available if OS delivery fails. */}
    }
    function notify(event){
      const t=event.trade,title=event.type==='OPEN'?`PAPER · Đã mở ${t.side} ${t.symbol}`:`PAPER · Đóng ${t.symbol} · ${t.reason}`;
      const body=event.type==='OPEN'?`Giá ${price(t.entry)} · SL ${price(t.sl)} · TP ${price(t.tp)} · Điểm ${t.score}`:`Giá ${price(t.exit)} · Lãi/lỗ ròng ${money(t.netPnl)} USDT${t.recovered?' · Khôi phục từ nến 1 phút':''}`;
      announce(title+' — '+body);beep();void systemNotification(title,body,t.id+'-'+event.type);
    }
    async function transaction(reducer){
      const work=()=>{
        const before=beforeSymbol(),fresh=load();let result;
        try{result=reducer(fresh)}catch(e){e.paperValidation=true;throw e}
        if(!result||result.book===fresh){book=fresh;render();return result}
        result.book.revision=fresh.revision+1;
        localStorage.setItem(KEY,JSON.stringify(result.book)); // Persist before acknowledging an entry or exit.
        book=result.book;storageError='';
        if(before!==beforeSymbol())adapter.monitoredChanged(before,beforeSymbol());
        if(result.event)notify(result.event);
        if(result.skip)message=result.skip;
        render();return result;
      };
      try{return hasLocks?await navigator.locks.request(LOCK,work):work()}
      catch(e){if(e.paperValidation){announce(e.message);render();return null}enabled=false;$('paperAuto').checked=false;storageError=`Không thể lưu paper: ${e.message}. Tự vào lệnh đã tắt.`;announce(storageError);render();return null}
    }
    function render(){
      const openWhy=$('paperOpenWhy')?.open===true;
      const expanded=new Set([...$('paperHistory').querySelectorAll('details[open]')].map(e=>e.dataset.tradeId));
      $('paperAuto').checked=enabled;$('paperAuto').disabled=!hasLocks||!!storageError||!book;
      $('paperTarget').textContent=`Theo dõi tín hiệu: ${adapter.selected()} · tối đa 1 lệnh mở`;
      $('paperStatus').textContent=storageError||recoveryError||(recovering?'Đang kiểm tra nến bị bỏ lỡ; tạm dừng mở/đóng theo giá mới.':!hasLocks?'Trình duyệt chưa hỗ trợ khóa chống lệnh trùng. Hãy dùng Chrome/Safari mới.':document.visibilityState!=='visible'?'Tab đang ẩn · tạm dừng mở lệnh mới.':enabled?message:'Tự vào lệnh đang TẮT. Lệnh đang mở vẫn được theo dõi khi có dữ liệu.');
      $('paperStatus').classList.toggle('paper-error',!!storageError||!!recoveryError);
      $('paperNotify').textContent=!('Notification' in root)?'Thông báo trong app':Notification.permission==='granted'?'✓ Đã bật thông báo':'Bật thông báo thiết bị';
      if(!book)return;
      const quote=book.open?latestQuotes.get(book.open.symbol):null,stats=core.stats(book,quote?.price||book.open?.lastPrice);
      $('paperEquity').textContent=money(stats.equity);$('paperCash').textContent=money(stats.cash);
      $('paperRealized').textContent=(stats.realized>=0?'+':'')+money(stats.realized);$('paperRealized').className=stats.realized>=0?'up':'down';
      $('paperCount').textContent=`${stats.closed} lệnh đóng · ${stats.wins} lệnh lãi`;
      const t=book.open;
      if(!t)$('paperOpen').innerHTML='<div class="paper-empty">Chưa có lệnh mở. Chỉ vào khi có LONG/SHORT XÁC NHẬN mới sau lúc bật.</div>';
      else{
        const fresh=quote&&Date.now()-quote.at<=10000&&!recovering&&!recoveryError;
        $('paperOpen').innerHTML=`<div class="paper-position-title"><strong class="${t.side==='LONG'?'up':'down'}">${escape(t.side)} · ${escape(t.symbol)}</strong><span>GIẢ LẬP · 1×</span></div>
          <div class="paper-position-grid"><div><span>Giá vào</span><b>${price(t.entry)}</b></div><div><span>Lãi/lỗ ròng ước tính</span><b class="${stats.unrealized>=0?'up':'down'}">${money(stats.unrealized)} USDT</b></div><div><span>Stop Loss</span><b>${price(t.sl)}</b></div><div><span>Take Profit</span><b>${price(t.tp)}</b></div></div>
          <p>${money(t.notional)} USDT · ${price(t.qty)} coin · ${stamp(t.entryAt)}</p><p>${fresh?'Giá theo dõi '+price(quote.price):'Đang chờ giá mới / kiểm tra lịch sử. PnL chỉ tham khảo.'}</p>
          <details id="paperOpenWhy" ${openWhy?'open':''}><summary>Lý do vào lệnh · Điểm ${t.score}</summary><p>${escape(t.why)}</p><p>${Object.entries(t.rsi).map(([tf,v])=>`${escape(tf)}: ${price(v.confirmed)} (trước ${price(v.previous)})`).join(' · ')}</p><p>Phí mỗi chiều ${t.feePct}% · Trượt giá ${t.slippagePct}% · SL ${t.slPct}% / TP ${t.tpPct}%</p></details>
          <button id="paperClose" type="button" class="paper-small-btn" ${fresh?'':'disabled'}>Đóng lệnh giả theo giá hiện tại</button>`;
        $('paperClose').onclick=()=>closeManual();
      }
      $('paper-initialCapital').disabled=!!book.open||book.trades.length>0;
      $('paperHistoryCount').textContent=String(book.trades.length);
      $('paperHistory').innerHTML=book.trades.slice(-historyCount).reverse().map(t=>`<details class="paper-history-item" data-trade-id="${escape(t.id)}" ${expanded.has(t.id)?'open':''}><summary><span>${escape(t.symbol)} · ${escape(t.side)} · ${escape(t.reason)}</span><b class="${t.netPnl>=0?'up':'down'}">${t.netPnl>=0?'+':''}${money(t.netPnl)}</b></summary><p>${stamp(t.entryAt)} → ${stamp(t.exitAt)}</p><p>Vào ${price(t.entry)} → Thoát ${price(t.exit)} · ${price(t.qty)} coin</p><p>SL ${price(t.sl)} · TP ${price(t.tp)} · Phí ${money(t.entryFee+t.exitFee)} USDT · Điểm ${t.score}</p><p>${escape(t.why)}</p><p>${Object.entries(t.rsi).map(([tf,v])=>`${escape(tf)} ${price(v.confirmed)} / trước ${price(v.previous)}`).join(' · ')}</p>${t.recovered?`<p>Khôi phục bằng nến 1 phút; thời gian thoát là cuối nến, không phải thời điểm tick chính xác.${t.ambiguous?' Nến chạm cả TP và SL: tính SL trước.':''}</p>`:''}</details>`).join('')||'<div class="paper-empty">Lịch sử lệnh sẽ xuất hiện ở đây.</div>';
      $('paperMore').hidden=book.trades.length<=historyCount;
      $('paperRetry').hidden=!recoveryError;
    }
    async function recover(){
      if(recovering||!book?.open||storageError)return;
      const id=book.open.id,symbol=book.open.symbol,since=book.open.lastObservedAt;
      recovering=true;recoveryError='';lastRecoveryTry=Date.now();render();
      try{
        const candles=await adapter.recoveryCandles(symbol,since,Date.now());
        const result=await transaction(fresh=>fresh.open?.id===id?core.replay(fresh,candles):{book:fresh});
        if(!result)throw new Error('Không ghi được kết quả khôi phục.');
        recoveryError='';feedAt=Date.now();lastSave=Date.now();
      }catch(e){recoveryError=`Chưa kiểm tra được lệnh mở: ${e.message}. Đang giữ nguyên lệnh; bấm Thử đồng bộ lại.`}
      finally{recovering=false;render();const q=book?.open&&latestQuotes.get(book.open.symbol);if(q&&!recoveryError)onQuote(book.open.symbol,q.price,q.at)}
    }
    function onQuote(symbol,value,at=Date.now()){
      const now=Date.now();if(!Number.isFinite(value)||value<=0||!Number.isFinite(at)||at>now+5000||now-at>10000)return;
      const previous=latestQuotes.get(symbol);if(previous&&previous.at>at)return;
      latestQuotes.set(symbol,{price:value,at});
      if(!book?.open||book.open.symbol!==symbol)return;
      if(recovering||storageError)return;
      if(recoveryError){if(now-lastRecoveryTry>30000)void recover();return}
      if(!feedAt||now-feedAt>10000){void recover();return}
      feedAt=now;
      if(!quoteTimer)quoteTimer=setTimeout(async()=>{
        quoteTimer=null;const t=book?.open,q=t&&latestQuotes.get(t.symbol);if(!t||!q||recovering||recoveryError||Date.now()-q.at>10000)return;
        const long=t.side==='LONG',hit=long?q.price<=t.sl||q.price>=t.tp:q.price>=t.sl||q.price<=t.tp;
        if(hit||Date.now()-lastSave>=5000){await transaction(fresh=>fresh.open?.id===t.id?core.mark(fresh,q.price,q.at):{book:fresh});lastSave=Date.now()}
        render();
      },250);
    }
    function onSignal(input){
      if(input.symbol!==selected){selected=input.symbol;armedAt=Date.now()}
      if(!enabled||!book||recovering||recoveryError||storageError||document.visibilityState!=='visible')return;
      const q=latestQuotes.get(input.symbol),now=Date.now();
      if(input.blocked||!adapter.connected()||!q||now-q.at>5000){message='Chờ dữ liệu và giá trực tiếp hợp lệ.';render();return}
      if(!['LONG','SHORT'].includes(input.result.signal)){message='Đang chờ LONG/SHORT XÁC NHẬN mới.';render();return}
      const signalAt=input.frames['15m'].closedAt+1;
      if((book.lastSignals[input.symbol]||0)>=signalAt)return;
      if(signalAt<=armedAt||now-signalAt>30000){message='Bỏ qua tín hiệu cũ; đang chờ lần xác nhận mới.';render();return}
      const signal={symbol:input.symbol,side:input.result.signal,score:input.result.score,price:q.price,signalAt,
        rsi:Object.fromEntries(Object.entries(input.frames).map(([tf,x])=>[tf,{confirmed:x.confirmed,previous:x.previous,closedAt:x.closedAt}])),
        why:input.reason};
      void transaction(fresh=>{
        if(!enabled||recovering||document.visibilityState!=='visible'||adapter.selected()!==signal.symbol||!adapter.connected()||Date.now()-q.at>5000)return {book:fresh};
        const result=core.acceptSignal(fresh,signal,{now:Date.now(),armedAt});
        if(result.event){feedAt=Date.now();lastSave=Date.now();message='Đã mở lệnh giả; đang theo dõi TP/SL.'}
        return result;
      });
    }
    async function closeManual(){
      const t=book?.open,q=t&&latestQuotes.get(t.symbol);
      if(!t||!q||Date.now()-q.at>10000||recovering||recoveryError){announce('Chưa có giá hợp lệ để đóng lệnh.');return}
      await transaction(fresh=>fresh.open?.id===t.id?core.close(fresh,q.price,q.at,'MANUAL'):{book:fresh});
    }
    function resume(){armedAt=Date.now();if(book?.open)void recover();render()}
    $('paperAuto').onchange=async e=>{
      enabled=e.target.checked&&hasLocks&&!storageError;armedAt=Date.now();message='Đã bật · chờ tín hiệu mới, không vào lại tín hiệu đang hiển thị.';
      if(enabled&&sound)await initAudio();render();
    };
    $('paperSound').checked=sound;$('paperSound').onchange=async e=>{sound=e.target.checked;try{localStorage.setItem(PREFS,JSON.stringify({sound}))}catch{}if(sound){await initAudio();beep()}};
    $('paperNotify').onclick=async()=>{
      if(!('Notification' in root)){announce('Thiết bị này dùng thông báo trong app.');return}
      try{const permission=await Notification.requestPermission();announce(permission==='granted'?'Đã bật thông báo thiết bị.':'Chưa cấp quyền; thông báo trong app vẫn hoạt động.');if(permission==='granted')void systemNotification('PAPER · Thông báo đã sẵn sàng','Sẽ báo khi mở hoặc đóng lệnh giả.','paper-test')}catch{announce('Không bật được thông báo thiết bị; vẫn báo trong app.')}render();
    };
    $('paperSave').onclick=async()=>{
      const cfg=Object.fromEntries(Object.keys(core.DEFAULTS).map(k=>[k,Number($('paper-'+k).value)]));
      try{core.config(cfg);const result=await transaction(fresh=>({book:core.configure(fresh,cfg)}));if(result){syncInputs();announce('Đã lưu cấu hình cho lệnh tiếp theo.')}}catch(e){announce(e.message)}
    };
    const download=(name,body,type)=>{const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
    $('paperBackup').onclick=()=>download('BinanceSignal-Paper-Backup.json',localStorage.getItem(KEY)||JSON.stringify(book,null,2),'application/json');
    $('paperCsv').onclick=()=>{
      if(!book)return;
      const cols=['id','symbol','side','entryAt','exitAt','entry','exit','qty','notional','sl','tp','entryFee','exitFee','grossPnl','netPnl','reason','score','rsi','why','recovered','ambiguous'];
      const cell=x=>'"'+String(typeof x==='object'?JSON.stringify(x):x??'').replace(/"/g,'""')+'"';
      download('BinanceSignal-Paper-History.csv','\uFEFF'+[cols.map(cell).join(','),...book.trades.map(t=>cols.map(k=>cell(t[k])).join(','))].join('\r\n'),'text/csv;charset=utf-8');
    };
    $('paperMore').onclick=()=>{historyCount+=20;render()};$('paperRetry').onclick=()=>void recover();
    root.addEventListener('storage',e=>{if(e.key!==KEY)return;const before=beforeSymbol();try{book=load();storageError='';adapter.monitoredChanged(before,beforeSymbol());syncInputs();render();if(book.open)void recover()}catch(error){storageError=error.message;enabled=false;render()}});
    syncInputs();render();
    return {onSignal,onQuote,resume,render,monitoredSymbols:()=>book?.open?[book.open.symbol]:[]};
  }};
})(globalThis);
