(function(root){
  'use strict';
  const KEY='bsm_paper_rsi_v1',PREFS='bsm_paper_prefs_v1',LOCK='bsm-paper-rsi-ledger-v1';
  root.PaperUI={create(adapter){
    const core=root.PaperTrading,$=id=>document.getElementById(id),panel=$('paperPanel');
    if(!panel)return null;
    let book=null,enabled=true,armedAt=Date.now(),recovering=false,recoveryError='',storageError='',message='Tự vào lệnh đã bật · đang chờ xác nhận RSI mới.',historyCount=20;
    let feedAt=0,lastSave=0,audio=null,toastTimer=null,quoteTimer=null,latestQuotes=new Map(),lastRecoveryTry=0,marketChecking=false;
    const hasLocks=typeof navigator.locks?.request==='function';
    const money=x=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}):'--';
    const price=x=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumSignificantDigits:9}):'--';
    const stamp=x=>new Date(x).toLocaleString('vi-VN');
    const diagnosticText=d=>[(d.cached?'Kết quả đã lưu lúc ':'Kiểm tra lúc ')+stamp(d.check?.checkedAt||d.at),d.requestSent===false?'Không gửi thêm yêu cầu tới OKX.':'',d.ok?'Dữ liệu kiểm tra: lấy được':'Dữ liệu kiểm tra: chưa lấy được',d.detail,d.check?.message,d.nextAllowedAt>Date.now()?'Kiểm tra tiếp sớm nhất sau '+new Date(d.nextAllowedAt).toLocaleTimeString('vi-VN'):''].filter(Boolean).join('\n');
    const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const sourceLabel=t=>core.sourceLabel(t);
    try{book=core.restore(localStorage.getItem(KEY))}catch(e){storageError=e.message}
    let sound=false,localAuto=true,remote=null,remoteMode=false,historySignature='',openSignature='',settingsDirty=false;try{const prefs=JSON.parse(localStorage.getItem(PREFS)||'{}');sound=prefs.sound===true;localAuto=prefs.auto!==false;enabled=localAuto}catch{}
    if(!hasLocks)enabled=false;
    const savePrefs=()=>{try{localStorage.setItem(PREFS,JSON.stringify({sound,auto:localAuto}))}catch{}};
    remote=root.RemotePaper?.create({update:remoteUpdated,event:e=>notify(e,false),pushReady:()=>announce('Đã đăng ký thông báo đẩy cho thiết bị này.')})||null;
    function remoteUpdated(){
      const wasRemote=remoteMode;
      if(remote?.configured()){remoteMode=true;const v=remote.view();if(v.state){book=core.restore(v.state.ledger);enabled=v.state.autoEnabled;storageError='';recovering=v.state.health.state==='recovering';recoveryError=v.connected&&v.state.health.state==='error'?v.state.health.detail:'';if(book.open)latestQuotes.set(book.open.symbol,{price:book.open.lastPrice,at:Date.now()-(v.state.serverTime-book.open.lastObservedAt),priceSource:core.sourceOf(book.open)});syncInputs()}else{book=null;enabled=false}}
      else if(remoteMode){remoteMode=false;recovering=false;recoveryError='';try{book=core.restore(localStorage.getItem(KEY));enabled=localAuto}catch(e){storageError=e.message;enabled=false}}
      render();
      if(wasRemote!==remoteMode)adapter.modeChanged?.();
    }
    const beforeSymbol=()=>book?.open?.symbol||null;
    function load(){return core.restore(localStorage.getItem(KEY))}
    function syncInputs(){if(!book||settingsDirty)return;for(const key of Object.keys(core.DEFAULTS))$('paper-'+key).value=book.config[key];$('paper-initialCapital').disabled=!!book.open||book.trades.length>0}
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
    function notify(event,system=true){
      const t=event.trade,title=event.type==='OPEN'?`PAPER · Đã mở ${t.side} ${t.symbol}`:`PAPER · Đóng ${t.symbol} · ${t.reason}`;
      const body=event.type==='OPEN'?`${sourceLabel(t)} · ${t.strategy?t.strategy+' · ':''}Giá ${price(t.entry)} · SL ${price(t.sl)} · TP ${price(t.tp)} · Bối cảnh ${t.score}`:`${sourceLabel(t)} · Giá ${price(t.exit)} · Lãi/lỗ ròng ${money(t.netPnl)} USDT${t.recovered?' · Khôi phục từ nến 1 phút':''}`;
      announce(title+' — '+body);beep();if(system)void systemNotification(title,body,t.id+'-'+event.type);
    }
    async function transaction(reducer){
      if(remote?.configured())throw new Error('Không ghi sổ trình duyệt trong chế độ máy chủ');
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
      const rv=remote?.view(),cloud=remote?.configured(),online=cloud&&rv.connected;
      $('paperAuto').checked=enabled;$('paperAuto').disabled=cloud?!online:!hasLocks||!!storageError||!book;
      if($('remoteStatus')){
        const cf=rv?.state?.platform==='cloudflare',hybrid=cf&&rv?.state?.executionMode==='hybrid',u=rv?.state?.usage;
        const failed=online&&rv.state.health.state==='error',mismatch=online&&(rv.state.strategyVersion!==root.RsiMtf.VERSION||rv.state.priceSource!==core.PRICE_SOURCE);
        const running=online&&!failed&&!mismatch&&rv.state.health.state==='live'&&enabled&&(!hybrid||rv.state.executor?.connected===true);
        $('remoteStatus').classList.toggle('online',!!running);$('remoteStatus').classList.toggle('error',!!cloud&&(!online||failed||mismatch));$('remoteStatus').classList.toggle('waiting',!!online&&!running&&!failed&&!mismatch);
        $('remoteStatusText').textContent=cloud?(online?`${hybrid?'Cloudflare + Vercel':cf?'Cloudflare':'Máy chủ'} 24/7 · ${rv.state.symbol} · ${core.sourceLabel({priceSource:rv.state.priceSource})} · ${rv.state.health.state==='live'?(enabled?'đang chạy':'tự vào lệnh đã tắt'):rv.state.health.detail}`:'Máy chủ mất kết nối · '+(rv.error||'đang kết nối')):'Trình duyệt · Cần kết nối máy chủ để chạy 24/7';
        $('remoteDisconnect').hidden=!cloud;$('remoteImport').hidden=!online||!!book?.open||!!book?.trades.length;
        $('remoteSettingsStatus').textContent=cloud?(online?(cf?`${hybrid?'Vercel xử lý; Cloudflare giữ lịch, sổ và push.':failed?'Cloudflare kết nối được; bot đang lỗi dữ liệu thị trường.':'Bot đã kết nối Cloudflare.'} TP/SL: nến đóng 1 phút. Hôm nay (UTC): ${u?.alarms||0} lượt bot · ${u?.apiRequests||0} lượt app · ${u?.marketRequests||0} lượt dữ liệu${hybrid?' · '+(u?.executorRequests||0)+' lượt Vercel':''}.`:'Bot chạy trên máy chủ, giữ trạng thái khi tắt app.'):'Không chuyển sang bot trình duyệt khi máy chủ mất kết nối.'):'';
        if($('remoteMarketCheck')){$('remoteMarketCheck').hidden=!cf;$('remoteMarketCheck').disabled=!online||marketChecking||rv?.state?.marketDiagnostic?.nextAllowedAt>Date.now();}
        if($('remoteMarketResult')&&rv?.state?.marketDiagnostic)$('remoteMarketResult').textContent=diagnosticText(rv.state.marketDiagnostic);
      }
      root.dispatchEvent(new CustomEvent('paper:state',{detail:{enabled,open:!!book?.open}}));
      $('paperTarget').textContent='Chỉ BTCUSDT · OKX SPOT · RSI v4.1 · tối đa 1 lệnh mở';
      $('paperStatus').textContent=cloud?(online?(recoveryError|| (enabled?'Tự vào lệnh đang BẬT trên máy chủ; không phụ thuộc điện thoại.':'Tự vào lệnh đang TẮT trên máy chủ.')):'Đang giữ sổ máy chủ. Chưa nhận được trạng thái mới; không tự mở lệnh trên trình duyệt.') : storageError||recoveryError||(recovering?'Đang kiểm tra nến bị bỏ lỡ; tạm dừng mở/đóng theo giá mới.':!hasLocks?'Trình duyệt chưa hỗ trợ khóa chống lệnh trùng. Hãy dùng Chrome/Safari mới.':document.visibilityState!=='visible'?'Tab đang ẩn · tạm dừng mở lệnh mới.':enabled?message:'Tự vào lệnh đang TẮT. Lệnh đang mở vẫn được theo dõi khi có dữ liệu.');
      $('paperStatus').classList.toggle('paper-error',!!storageError||!!recoveryError);
      if(online&&(rv.state.strategyVersion!==root.RsiMtf.VERSION||rv.state.priceSource!==core.PRICE_SOURCE)){$('paperStatus').textContent='Máy chủ chưa dùng nguồn OKX Spot mới. Cập nhật và deploy backend v3.8.0 để đồng bộ nguồn giá.';$('paperStatus').classList.add('paper-error')}
      if(book?.open&&book.open.symbol!==core.PAPER_SYMBOL)$('paperStatus').textContent+=` Lệnh cũ ${book.open.symbol} được quản lý đến khi đóng; lệnh mới chỉ BTCUSDT.`;
      if(book?.open&&core.sourceOf(book.open)!==core.PRICE_SOURCE)$('paperStatus').textContent+=' Lệnh cũ giữ nguyên nguồn '+sourceLabel(book.open)+' đến khi đóng.';
      $('paperNotify').textContent=!('Notification' in root)?'Thông báo trong app':Notification.permission==='granted'?'✓ Đã bật thông báo':'Bật thông báo thiết bị';
      if(!book)return;
      const observed=book.open?latestQuotes.get(book.open.symbol):null,quote=observed?.priceSource===core.sourceOf(book.open)?observed:null,stats=core.stats(book,quote?.price||book.open?.lastPrice);
      $('paperEquity').textContent=money(stats.equity);$('paperCash').textContent=money(stats.cash);
      $('paperRealized').textContent=(stats.realized>=0?'+':'')+money(stats.realized);$('paperRealized').className=stats.realized>=0?'up':'down';
      $('paperCount').textContent=`${stats.closed} lệnh đóng · ${stats.wins} lệnh lãi`;
      const t=book.open;
      if(!t){if(openSignature!=='none'){$('paperOpen').innerHTML='<div class="paper-empty">Chưa có lệnh mở. Chờ lần xác nhận RSI mới.</div>';openSignature='none'}}
      else{
        const fresh=quote&&Date.now()-quote.at<=10000&&!recovering&&!recoveryError&&(!cloud||online);
        const canClose=cloud?online&&!recovering&&!recoveryError:core.sourceOf(t)!==core.PRICE_SOURCE?!recovering&&!storageError:fresh;
        if(openSignature!==t.id){openSignature=t.id;$('paperOpen').innerHTML=`<div class="paper-position-title"><strong class="${t.side==='LONG'?'up':'down'}">${escape(t.side)} · ${escape(t.symbol)} · ${sourceLabel(t)}</strong><span>GIẢ LẬP · 1×</span></div>
          <div class="paper-position-grid"><div><span>Giá vào</span><b>${price(t.entry)}</b></div><div><span>Lãi/lỗ ròng ước tính</span><b id="paperOpenPnl" class="${stats.unrealized>=0?'up':'down'}">${money(stats.unrealized)} USDT</b></div><div><span>Stop Loss</span><b>${price(t.sl)}</b></div><div><span>Take Profit</span><b>${price(t.tp)}</b></div></div>
          <p>${money(t.notional)} USDT · ${price(t.qty)} coin · ${stamp(t.entryAt)}</p><p id="paperQuote">${fresh?'Giá theo dõi '+price(quote.price):'Đang chờ giá mới / kiểm tra lịch sử. PnL chỉ tham khảo.'}</p>
          <details id="paperOpenWhy" ${openWhy?'open':''}><summary>${t.strategy?'v4.1 · '+escape(t.strategy):'Bộ RSI cũ'} · Lý do vào lệnh</summary><p>${escape(t.why)}</p><p>${Object.entries(t.rsi).map(([tf,v])=>`${escape(tf)}: ${price(v.confirmed)} (trước ${price(v.previous)})`).join(' · ')}</p><p>Phí mỗi chiều ${t.feePct}% · Trượt giá ${t.slippagePct}% · SL ${t.slPct}% / TP ${t.tpPct}%</p></details>
          <button id="paperClose" type="button" class="paper-small-btn" ${canClose?'':'disabled'}>Đóng lệnh giả theo giá hiện tại</button>`;
        $('paperClose').onclick=()=>closeManual();}
        $('paperClose').disabled=!canClose;$('paperOpenPnl').textContent=money(stats.unrealized)+' USDT';$('paperOpenPnl').className=stats.unrealized>=0?'up':'down';$('paperQuote').textContent=fresh?'Giá theo dõi '+price(quote.price):'Đang chờ giá mới / kiểm tra lịch sử. PnL chỉ tham khảo.';
      }
      $('paper-initialCapital').disabled=!!book.open||book.trades.length>0;
      $('paperHistoryCount').textContent=String(book.trades.length);
      const nextHistorySignature=book.trades.length+'|'+historyCount+'|'+(book.trades.at(-1)?.id||'');
      if(nextHistorySignature!==historySignature){historySignature=nextHistorySignature;$('paperHistory').innerHTML=book.trades.slice(-historyCount).reverse().map(t=>`<details class="paper-history-item" data-trade-id="${escape(t.id)}" ${expanded.has(t.id)?'open':''}><summary><span>${escape(t.symbol)} · ${escape(t.side)} · ${sourceLabel(t)} · ${escape(t.strategy||'Bộ cũ')} · ${escape(t.reason)}</span><b class="${t.netPnl>=0?'up':'down'}">${t.netPnl>=0?'+':''}${money(t.netPnl)}</b></summary><p>${stamp(t.entryAt)} → ${stamp(t.exitAt)}</p><p>Vào ${price(t.entry)} → Thoát ${price(t.exit)} · ${price(t.qty)} coin</p><p>SL ${price(t.sl)} · TP ${price(t.tp)} · Phí ${money(t.entryFee+t.exitFee)} USDT · Bối cảnh ${t.score}</p><p>${escape(t.why)}</p><p>${Object.entries(t.rsi).map(([tf,v])=>`${escape(tf)} ${price(v.confirmed)} / trước ${price(v.previous)}`).join(' · ')}</p>${t.recovered?`<p>Khôi phục bằng nến 1 phút; thời gian thoát là cuối nến, không phải thời điểm tick chính xác.${t.ambiguous?' Nến chạm cả TP và SL: tính SL trước.':''}</p>`:''}</details>`).join('')||'<div class="paper-empty">Lịch sử lệnh sẽ xuất hiện ở đây.</div>';}
      $('paperMore').hidden=book.trades.length<=historyCount;
      $('paperRetry').hidden=!recoveryError;
    }
    async function recover(){
      if(remote?.configured()){await remote.refresh();return}
      if(recovering||!book?.open||storageError)return;
      const id=book.open.id,symbol=book.open.symbol,since=book.open.lastObservedAt;
      recovering=true;recoveryError='';lastRecoveryTry=Date.now();render();
      try{
        const candles=await adapter.recoveryCandles(symbol,since,Date.now(),core.sourceOf(book.open));
        const result=await transaction(fresh=>fresh.open?.id===id?core.replay(fresh,candles):{book:fresh});
        if(!result)throw new Error('Không ghi được kết quả khôi phục.');
        if(book?.open&&core.sourceOf(book.open)!==core.PRICE_SOURCE&&adapter.exitQuote){const q=await adapter.exitQuote(symbol,core.sourceOf(book.open));latestQuotes.set(symbol,q);await transaction(fresh=>fresh.open?.id===id?core.mark(fresh,q.price,q.at):{book:fresh})}
        recoveryError='';feedAt=Date.now();lastSave=Date.now();
      }catch(e){recoveryError=`Chưa kiểm tra được lệnh mở: ${e.message}. Đang giữ nguyên lệnh; bấm Thử đồng bộ lại.`}
      finally{recovering=false;render();const q=book?.open&&latestQuotes.get(book.open.symbol);if(q&&!recoveryError)onQuote(book.open.symbol,q.price,q.at,q.priceSource)}
    }
    function onQuote(symbol,value,at=Date.now(),priceSource=core.PRICE_SOURCE){
      if(remote?.configured())return;
      if(book?.open?.symbol===symbol&&core.sourceOf(book.open)!==priceSource){if(!recovering&&Date.now()-lastRecoveryTry>60000)void recover();return}
      const now=Date.now();if(!Number.isFinite(value)||value<=0||!Number.isFinite(at)||at>now+5000||now-at>10000)return;
      const previous=latestQuotes.get(symbol);if(previous&&previous.at>at)return;
      latestQuotes.set(symbol,{price:value,at,priceSource});
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
      if(remote?.configured()||input.symbol!==core.PAPER_SYMBOL)return;
      if(!enabled||!book||recovering||recoveryError||storageError||document.visibilityState!=='visible')return;
      const q=latestQuotes.get(input.symbol),now=Date.now();
      if(input.blocked||!adapter.connected()||!q||q.priceSource!==core.PRICE_SOURCE||now-q.at>5000){message='Chờ dữ liệu và giá OKX Spot trực tiếp hợp lệ.';render();return}
      if(!['LONG','SHORT'].includes(input.result.signal)){message='Đang chờ LONG/SHORT XÁC NHẬN mới.';render();return}
      const signalAt=input.frames['15m'].closedAt+1;
      if((book.lastSignals[input.symbol]||0)>=signalAt)return;
      if(signalAt<=armedAt||now-signalAt>30000){message='Bỏ qua tín hiệu cũ; đang chờ lần xác nhận mới.';render();return}
      const signal={symbol:input.symbol,side:input.result.signal,priceSource:core.PRICE_SOURCE,score:input.result.score,price:q.price,signalAt,
        strategyVersion:input.result.version,ruleSet:input.result.ruleSet,strategy:input.result.winner.strategy,checks:input.result.winner.checks,riskPctSuggested:input.result.winner.riskPct,
        rsi:Object.fromEntries(Object.entries(input.frames).map(([tf,x])=>[tf,{confirmed:x.confirmed,previous:x.previous,closedAt:x.closedAt}])),
        why:input.reason};
      void transaction(fresh=>{
        if(!enabled||recovering||document.visibilityState!=='visible'||signal.symbol!==core.PAPER_SYMBOL||!adapter.connected()||Date.now()-q.at>5000)return {book:fresh};
        const result=core.acceptSignal(fresh,signal,{now:Date.now(),armedAt});
        if(result.event){feedAt=Date.now();lastSave=Date.now();message='Đã mở lệnh giả; đang theo dõi TP/SL.'}
        return result;
      });
    }
    async function closeManual(){
      if(remote?.configured()){try{await remote.action('/api/close',{id:book?.open?.id})}catch(e){announce(e.message)}return}
      if(book?.open&&core.sourceOf(book.open)!==core.PRICE_SOURCE){await recover();if(!book?.open)return}
      const t=book?.open,q=t&&latestQuotes.get(t.symbol);
      if(!t||!q||q.priceSource!==core.sourceOf(t)||Date.now()-q.at>10000||recovering||recoveryError){announce('Chưa có giá hợp lệ đúng nguồn để đóng lệnh.');return}
      await transaction(fresh=>fresh.open?.id===t.id?core.close(fresh,q.price,q.at,'MANUAL'):{book:fresh});
    }
    function resume(){if(remote?.configured()){void remote.refresh();render();return}armedAt=Date.now();if(book?.open)void recover();render()}
    $('paperAuto').onchange=async e=>{
      if(remote?.configured()){try{await remote.action('/api/auto',{enabled:e.target.checked})}catch(error){announce(error.message);render()}return}
      enabled=e.target.checked&&hasLocks&&!storageError;localAuto=enabled;savePrefs();armedAt=Date.now();message='Đã bật · chờ tín hiệu mới, không vào lại tín hiệu đang hiển thị.';
      if(enabled&&sound)await initAudio();render();
    };
    $('paperSound').checked=sound;$('paperSound').onchange=async e=>{sound=e.target.checked;savePrefs();if(sound){await initAudio();beep()}};
    $('paperNotify').onclick=async()=>{
      if(remote?.configured()){try{await remote.push({test:true})}catch(e){announce(e.message)}render();return}
      if(!('Notification' in root)){announce('Thiết bị này dùng thông báo trong app.');return}
      try{const permission=await Notification.requestPermission();announce(permission==='granted'?'Đã bật thông báo thiết bị.':'Chưa cấp quyền; thông báo trong app vẫn hoạt động.');if(permission==='granted')void systemNotification('PAPER · Thông báo đã sẵn sàng','Sẽ báo khi mở hoặc đóng lệnh giả.','paper-test')}catch{announce('Không bật được thông báo thiết bị; vẫn báo trong app.')}render();
    };
    $('paperSave').onclick=async()=>{
      const cfg=Object.fromEntries(Object.keys(core.DEFAULTS).map(k=>[k,Number($('paper-'+k).value)]));
      try{core.config(cfg);if(remote?.configured()){await remote.action('/api/config',{config:cfg});settingsDirty=false;syncInputs();announce('Đã lưu cấu hình trên máy chủ.');return}const result=await transaction(fresh=>({book:core.configure(fresh,cfg)}));if(result){settingsDirty=false;syncInputs();announce('Đã lưu cấu hình cho lệnh tiếp theo.')}}catch(e){announce(e.message)}
    };
    const download=(name,body,type)=>{const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
    $('paperBackup').onclick=()=>download('BinanceSignal-Paper-Backup.json',remote?.configured()?JSON.stringify(book,null,2):(localStorage.getItem(KEY)||JSON.stringify(book,null,2)),'application/json');
    $('paperCsv').onclick=()=>{
      if(!book)return;
      const cols=['id','symbol','side','priceSource','strategyVersion','ruleSet','strategy','entryAt','exitAt','entry','exit','qty','notional','sl','tp','entryFee','exitFee','grossPnl','netPnl','reason','score','rsi','why','checks','riskPctSuggested','recovered','ambiguous'];
      const cell=x=>'"'+String(typeof x==='object'?JSON.stringify(x):x??'').replace(/"/g,'""')+'"';
      download('BinanceSignal-Paper-History.csv','\uFEFF'+[cols.map(cell).join(','),...book.trades.map(t=>cols.map(k=>cell(t[k])).join(','))].join('\r\n'),'text/csv;charset=utf-8');
    };
    $('paperMore').onclick=()=>{historyCount+=20;render()};$('paperRetry').onclick=()=>void recover();
    root.addEventListener('storage',e=>{if(e.key===PREFS){try{const prefs=JSON.parse(localStorage.getItem(PREFS)||'{}');sound=prefs.sound===true;localAuto=prefs.auto!==false;if(!remote?.configured()){enabled=localAuto&&hasLocks&&!storageError;armedAt=Date.now()}$('paperSound').checked=sound;render()}catch{}return}if(e.key!==KEY||remote?.configured())return;const before=beforeSymbol();try{book=load();storageError='';adapter.monitoredChanged(before,beforeSymbol());syncInputs();render();if(book.open)void recover()}catch(error){storageError=error.message;enabled=false;render()}});
    if($('remoteConnect')){
      if($('remoteMarketCheck'))$('remoteMarketCheck').onclick=async()=>{
        const button=$('remoteMarketCheck');marketChecking=true;button.disabled=true;
        try{const d=await remote.diagnoseMarket();$('remoteMarketResult').textContent=diagnosticText(d);await remote.refresh()}
        catch(e){$('remoteMarketResult').textContent=e.message}finally{marketChecking=false;render()}
      };
      const existing=remote?.view().cfg;if(existing){$('remoteUrl').value=existing.url;$('remoteToken').value=existing.token}
      $('remoteConnect').onclick=async()=>{try{await remote.connect($('remoteUrl').value,$('remoteToken').value);announce('Đã kết nối máy chủ 24/7. Bật thông báo đẩy một lần cho thiết bị này.')}catch(e){announce(e.message)}};
      $('remoteDisconnect').onclick=async()=>{try{await remote.disconnect();enabled=false;localAuto=false;armedAt=Date.now();savePrefs();render();announce('Đã dừng tự mở lệnh và chuyển về sổ trình duyệt.')}catch(e){announce(e.message)}};
      $('remoteImport').onclick=async()=>{try{const local=core.restore(localStorage.getItem(KEY));await remote.action('/api/import',{ledger:local});announce('Đã chuyển bản sao sổ trình duyệt lên máy chủ.')}catch(e){announce(e.message)}};
    }
    for(const key of Object.keys(core.DEFAULTS))$('paper-'+key).addEventListener('input',()=>{settingsDirty=true});
    syncInputs();render();
    return {onSignal,onQuote,resume,render,selectedChanged:()=>render(),localActive:()=>!remote?.configured(),monitoredSymbols:()=>remote?.configured()?[]:[...new Set([core.PAPER_SYMBOL,...(book?.open?[book.open.symbol]:[])])]};
  }};
})(globalThis);
