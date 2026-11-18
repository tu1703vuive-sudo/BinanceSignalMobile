// Verify through the deployed Durable Object, not the installer machine's market connection.
export async function verifyMarket(url,token,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=10}={}){
  async function call(path,body){const r=await fetcher(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const value=await r.json();if(!r.ok)throw new Error(value.error||`API HTTP ${r.status}`);return value}
  const initial=await call('/api/state');if(initial.platform!=='cloudflare'||initial.priceSource!=='okx-spot'||initial.executionMode!=='hybrid')throw new Error('Backend chưa chạy chế độ Cloudflare + Vercel; kiểm tra thư mục mã nguồn vừa deploy');
  const complete=s=>['1M','1d','4h','1h','15m'].every(tf=>s.frames?.[tf]?.ready&&s.frames[tf].healthy)&&(!s.serverTime||Math.floor((s.frames['15m'].closedAt+1)/900000)===Math.floor(s.serverTime/900000))&&(s.executionMode!=='hybrid'||s.executor?.connected===true);
  if(initial.autoEnabled!==false&&initial.health.state==='live'&&complete(initial))return {apiReady:true,marketReady:true,detail:'Bot đã đồng bộ đủ 5 khung OKX Spot; không tạo thêm lượt kiểm tra dữ liệu.'};
  const d=await call('/api/diagnostics/market',{});
  if(!d.ok)return {apiReady:true,marketReady:false,detail:d.detail,upstream:d.check?.message};
  for(let i=0;i<attempts;i++){
    const s=await call('/api/state');
    if(s.autoEnabled!==false&&s.health.state==='live'&&complete(s))return {apiReady:true,marketReady:true,detail:'Cloudflare đã lấy được dữ liệu OKX Spot và bot đã kiểm tra xong dữ liệu.'};
    if(s.autoEnabled===false)return {apiReady:true,marketReady:false,paused:true,detail:'Nến OKX Spot thử lấy được; tự vào lệnh đang TẮT. Bật lại trong app khi muốn bot đồng bộ và theo dõi.'};
    if(s.health.state==='error')return {apiReady:true,marketReady:false,detail:s.health.detail,upstream:s.health.upstream?.message};
    if(i<attempts-1)await wait(1500);
  }
  return {apiReady:true,marketReady:false,checking:true,detail:'Nến OKX Spot thử đã lấy được; bot đang đồng bộ. Kiểm tra trạng thái trong app trước khi sử dụng.'};
}
