'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),webpush=require('web-push');
const dir=path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const keyfile=path.join(dir,'vapid.json');if(!fs.existsSync(keyfile))fs.writeFileSync(keyfile,JSON.stringify(webpush.generateVAPIDKeys()),{mode:0o600});
const env=path.join(__dirname,'.env');if(!fs.existsSync(env))fs.writeFileSync(env,'BOT_TOKEN='+crypto.randomBytes(32).toString('hex')+'\nALLOWED_ORIGINS=https://tu1703vuive-sudo.github.io\nVAPID_SUBJECT=mailto:admin@example.com\nHOST=127.0.0.1\nPORT=8787\n',{mode:0o600});
console.log('Đã tạo cấu hình riêng tại server/.env và khóa push trong server/data. Giữ kín các file này. Sửa email liên hệ và ALLOWED_ORIGINS trước khi chạy.');
