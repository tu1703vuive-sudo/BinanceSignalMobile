import {createECDH,randomBytes} from 'node:crypto';
import {existsSync,writeFileSync,chmodSync,readFileSync} from 'node:fs';
if(existsSync('secrets.json')){
  const s=JSON.parse(readFileSync('secrets.json','utf8'));
  if(!s.BOT_TOKEN||!s.VAPID_PUBLIC_KEY||!s.VAPID_PRIVATE_KEY)throw new Error('secrets.json không đầy đủ. Giữ bản sao trước khi sửa.');
  console.log('Giữ nguyên mã kết nối và khóa push hiện tại.');
}else{
  const key=createECDH('prime256v1');key.generateKeys();
  const secrets={BOT_TOKEN:randomBytes(32).toString('hex'),VAPID_PUBLIC_KEY:key.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:key.getPrivateKey().toString('base64url')};
  writeFileSync('secrets.json',JSON.stringify(secrets,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('Đã tạo mã kết nối và khóa push trong secrets.json. Không tải file này lên GitHub.');
}
try{chmodSync('secrets.json',0o600)}catch{}
console.log('Tiếp theo: npm run login, sau đó npm run deploy.');
