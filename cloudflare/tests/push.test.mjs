import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes,createPublicKey,verify} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {subscription} from '../worker.mjs';
const require=createRequire(import.meta.url);
test('Web Push encrypts payload and signs valid VAPID for correct audience',async()=>{
  const client=createECDH('prime256v1');client.generateKeys();const server=createECDH('prime256v1');server.generateKeys();
  const auth=randomBytes(16),sub={endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys:{auth:auth.toString('base64url'),p256dh:client.getPublicKey().toString('base64url')}};
  const msg={id:'fixture',title:'PAPER · LONG BTCUSDT',body:'Nến đóng 1 phút'},publicKey=server.getPublicKey(),vapid={publicKey:publicKey.toString('base64url'),privateKey:server.getPrivateKey().toString('base64url'),subject:'https://example.com/'};
  const details=await buildPushPayload({data:JSON.stringify(msg)},subscription(sub),vapid);assert.equal(details.headers['content-encoding'],'aes128gcm');assert.equal(details.body.length,4096);
  const jwt=details.headers.authorization.match(/^vapid t=(.*), k=/)[1],parts=jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  assert.equal(claims.aud,'https://fcm.googleapis.com');assert.ok(claims.exp>Date.now()/1000);assert.ok(claims.exp<Date.now()/1000+86400);
  const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:publicKey.subarray(1,33).toString('base64url'),y:publicKey.subarray(33).toString('base64url')},format:'jwk'});
  assert.ok(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
  // Independent decoder from the existing Node push server, when installed.
  let ece;try{ece=require('../../server/node_modules/http_ece')}catch{}
  if(ece)assert.deepEqual(JSON.parse(ece.decrypt(Buffer.from(details.body),{version:'aes128gcm',privateKey:client,authSecret:auth}).toString()),msg);
  assert.throws(()=>subscription({...sub,endpoint:'https://localhost/private'}),/Endpoint/);
  assert.throws(()=>subscription({...sub,keys:{...sub.keys,auth:'abc'}}),/Khóa/);
});
