(function(root){'use strict';root.MobileUI={init(){
 const $=id=>document.getElementById(id),sheet=$('appSettings');
 $('appSettingsBtn').onclick=()=>{if(sheet.showModal)sheet.showModal();else sheet.setAttribute('open','')};
 $('appSettingsClose').onclick=()=>{if(sheet.close)sheet.close();else sheet.removeAttribute('open')};
 sheet.addEventListener('click',e=>{if(e.target===sheet&&e.clientY<sheet.getBoundingClientRect().top){if(sheet.close)sheet.close();else sheet.removeAttribute('open')}});
 $('watchManageBtn').onclick=()=>{const editing=$('watchManage').hidden;$('watchManage').hidden=!editing;$('watchlist').classList.toggle('editing',editing);$('watchManageBtn').setAttribute('aria-expanded',String(editing));if(editing)$('symbolInput').focus()};
 const buttons=[...document.querySelectorAll('.bottom-nav [data-section]')];let clickedAt=0;
 const activate=id=>buttons.forEach(b=>{const active=b.dataset.section===id;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current')});
 buttons.forEach(b=>b.onclick=()=>{clickedAt=Date.now();activate(b.dataset.section);$(b.dataset.section).scrollIntoView({behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})});activate('watchlist');
 if('IntersectionObserver'in root){const observer=new IntersectionObserver(entries=>{if(Date.now()-clickedAt<1000)return;const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio);if(visible[0])activate(visible[0].target.id)},{rootMargin:'-75px 0px -25% 0px',threshold:[.1,.3,.6]});buttons.forEach(b=>observer.observe($(b.dataset.section)))}
 const clock=()=>{if(document.visibilityState!=='visible')return;const s=900-Math.floor(Date.now()/1000)%900;$('rsiCountdown').textContent=`15M · ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};clock();setInterval(clock,1000);
}}})(globalThis);
