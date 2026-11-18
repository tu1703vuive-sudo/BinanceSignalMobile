import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('Windows-compatible setup preserves app/push keys and reuses the separate executor token',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hybrid-setup-')),script=resolve('cloudflare/hybrid-setup.mjs');
  try{
    const original={BOT_TOKEN:'existing-app-key',VAPID_PUBLIC_KEY:'existing-public-key',VAPID_PRIVATE_KEY:'existing-private-key'};
    await writeFile(join(directory,'secrets.json'),JSON.stringify(original));
    const out=execFileSync(process.execPath,[script,'https://paper-fixture.vercel.app'],{cwd:directory,encoding:'utf8'}),first=JSON.parse(await readFile(join(directory,'secrets.json'),'utf8'));
    for(const [key,value] of Object.entries(original))assert.equal(first[key],value);
    assert.equal(first.EXECUTOR_URL,'https://paper-fixture.vercel.app/api/run');assert.ok(first.EXECUTOR_TOKEN.length>=32);assert.ok(!out.includes(first.EXECUTOR_TOKEN));assert.ok(!out.includes(original.VAPID_PRIVATE_KEY));
    execFileSync(process.execPath,[script,'https://paper-next.vercel.app'],{cwd:directory,encoding:'utf8'});const second=JSON.parse(await readFile(join(directory,'secrets.json'),'utf8'));assert.equal(second.EXECUTOR_TOKEN,first.EXECUTOR_TOKEN);assert.equal(second.EXECUTOR_URL,'https://paper-next.vercel.app/api/run');
    const instructions=await readFile(join(directory,'hybrid-connection.txt'),'utf8');assert.ok(instructions.includes(first.EXECUTOR_TOKEN));assert.ok(!instructions.includes(original.BOT_TOKEN));assert.ok(!instructions.includes(original.VAPID_PRIVATE_KEY));
  }finally{await rm(directory,{recursive:true,force:true})}
});
