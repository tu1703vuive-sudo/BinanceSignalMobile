import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {verifyMarket} from './verify.mjs';
import {executorUrl} from './hybrid-engine.mjs';
const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('wrangler/package.json')),'bin','wrangler.js');
const secrets=existsSync('secrets.json')?JSON.parse(readFileSync('secrets.json','utf8')):null;
if(!secrets?.BOT_TOKEN||!secrets.VAPID_PUBLIC_KEY||!secrets.VAPID_PRIVATE_KEY)throw new Error('Chạy npm run setup trước.');
if(!secrets.EXECUTOR_URL||secrets.EXECUTOR_TOKEN?.length<32)throw new Error('Chạy npm run hybrid để chuẩn bị khóa và điền URL Vercel trước khi deploy bản kết hợp. Giữ secrets.json cũ.');
executorUrl(secrets.EXECUTOR_URL);
function run(args){const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',stdio:['inherit','pipe','inherit']});if(result.stdout)process.stdout.write(result.stdout);if(result.status!==0)process.exit(result.status||1);return result.stdout}
const output=run(['deploy']);
run(['secret','bulk','secrets.json']);
const url=output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i)?.[0];
const content=`SIGNAL PAPER · CLOUDFLARE\n\nĐịa chỉ máy chủ: ${url||'Lấy URL workers.dev trong kết quả deploy / Cloudflare Dashboard'}\nMã kết nối: ${secrets.BOT_TOKEN}\n\nMở app GitHub Pages → Paper Trading → Cài đặt & thông báo → Chạy 24/7.\nĐiền URL và mã trên, nhấn Kết nối 24/7.\nNhấn Bật thông báo thiết bị một lần, rồi gửi thông báo thử.\nKhông đăng file này hoặc secrets.json lên GitHub.\n`;
writeFileSync('connection.txt',content,{mode:0o600});
if(url){
  try{
    const check=await verifyMarket(url,secrets.BOT_TOKEN);
    console.log('\n'+check.detail);if(check.upstream)console.log('Phản hồi dữ liệu: '+check.upstream);
    console.log(check.marketReady?'Đã xác nhận Cloudflare → Vercel → OKX. Mở app và kiểm tra thông báo thử.':'Worker và secrets đã được tải lên; chưa xác nhận bot đủ dữ liệu để hoạt động. Kiểm tra Vercel + OKX trong app.');
    console.log('Mở connection.txt để lấy URL và mã kết nối hiện có.');
  }catch(e){console.warn('\nWorker và secrets đã được tải lên, nhưng bước kiểm tra kết nối chưa đạt: '+e.message);console.warn('Mở /health và Kiểm tra dữ liệu từ cloud trong app. Không cần tạo lại khóa.');}
}else console.log('Đã tải secrets. Mở connection.txt rồi lấy URL từ Dashboard.');
