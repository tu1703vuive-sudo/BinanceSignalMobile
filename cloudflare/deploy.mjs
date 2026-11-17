import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('wrangler/package.json')),'bin','wrangler.js');
const secrets=existsSync('secrets.json')?JSON.parse(readFileSync('secrets.json','utf8')):null;
if(!secrets?.BOT_TOKEN||!secrets.VAPID_PUBLIC_KEY||!secrets.VAPID_PRIVATE_KEY)throw new Error('Chạy npm run setup trước.');
function run(args){const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',stdio:['inherit','pipe','inherit']});if(result.stdout)process.stdout.write(result.stdout);if(result.status!==0)process.exit(result.status||1);return result.stdout}
const output=run(['deploy']);
run(['secret','bulk','secrets.json']);
const url=output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i)?.[0];
const content=`SIGNAL PAPER · CLOUDFLARE\n\nĐịa chỉ máy chủ: ${url||'Lấy URL workers.dev trong kết quả deploy / Cloudflare Dashboard'}\nMã kết nối: ${secrets.BOT_TOKEN}\n\nMở app GitHub Pages → Paper Trading → Cài đặt & thông báo → Chạy 24/7.\nĐiền URL và mã trên, nhấn Kết nối 24/7.\nNhấn Bật thông báo thiết bị một lần, rồi gửi thông báo thử.\nKhông đăng file này hoặc secrets.json lên GitHub.\n`;
writeFileSync('connection.txt',content,{mode:0o600});
if(url){
  const r=await fetch(url+'/api/state',{headers:{Authorization:'Bearer '+secrets.BOT_TOKEN},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`Đã deploy nhưng kiểm tra API chưa thành công: HTTP ${r.status}. Xem Dashboard trước khi sử dụng.`);
  const state=await r.json();if(!state.ledger||state.platform!=='cloudflare')throw new Error('API trả dữ liệu không hợp lệ');
  console.log('\nAPI đã kết nối. Lịch bot đã được tạo. Mở connection.txt để lấy URL và mã kết nối.');
  console.log('Chờ trạng thái Cloudflare trong app chuyển sang đang chạy; kiểm tra thông báo thử trên điện thoại.');
}else console.log('Đã tải secrets. Mở connection.txt rồi lấy URL từ Dashboard.');
