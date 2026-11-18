import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {executorUrl} from './hybrid-engine.mjs';

await import('./setup.mjs');
const secrets=JSON.parse(readFileSync('secrets.json','utf8'));
if(!secrets.EXECUTOR_TOKEN)secrets.EXECUTOR_TOKEN=randomBytes(32).toString('hex');
if(typeof secrets.EXECUTOR_TOKEN!=='string'||secrets.EXECUTOR_TOKEN.length<32)throw new Error('EXECUTOR_TOKEN hiện có không hợp lệ; cần ít nhất 32 ký tự. Giữ bản sao secrets.json trước khi sửa.');
let url=process.argv[2];
if(url===undefined&&process.stdin.isTTY){const prompt=createInterface({input:process.stdin,output:process.stdout});url=await prompt.question('URL Production Vercel (Enter de tao khoa truoc, chua can URL): ');prompt.close()}
if(url?.trim())secrets.EXECUTOR_URL=executorUrl(url.trim());
writeFileSync('secrets.json',JSON.stringify(secrets,null,2)+'\n',{mode:0o600});
writeFileSync('hybrid-connection.txt',`SIGNAL · CLOUDFLARE + VERCEL\n\nVercel Environment Variable (Production):\nEXECUTOR_TOKEN=${secrets.EXECUTOR_TOKEN}\n\nCloudflare EXECUTOR_URL: ${secrets.EXECUTOR_URL||'Chua dien. Deploy Vercel truoc, sau do chay lai npm run hybrid -- https://TEN-DU-AN.vercel.app'}\n\nKhoa nay khac ma ket noi app. Khong tai file nay/secrets.json len GitHub va khong gui vao chat.\n`,{mode:0o600});
for(const name of ['secrets.json','hybrid-connection.txt'])try{chmodSync(name,0o600)}catch{}
console.log('\nĐã giữ mã app/khóa push cũ và chuẩn bị khóa riêng cho Vercel.');
console.log('Mở hybrid-connection.txt, thêm EXECUTOR_TOKEN vào Vercel → Settings → Environment Variables → Production.');
if(secrets.EXECUTOR_URL)console.log('Đã lưu URL Vercel. Sau khi deploy Vercel và đặt đúng khóa, chạy npm run deploy trong thư mục cloudflare.');
else console.log('Deploy Vercel trước. Sau đó: npm run hybrid -- https://TEN-DU-AN.vercel.app rồi npm run deploy.');
