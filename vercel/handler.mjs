import {createHash,timingSafeEqual} from 'node:crypto';
import {runJob} from './runner.mjs';
import {MAX_BYTES} from '../hybrid-protocol.mjs';

const digest=value=>createHash('sha256').update(value).digest();
function reply(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(value))}
export function createHandler({token=process.env.EXECUTOR_TOKEN,runner=runJob}={}){
  return async(req,res)=>{
    if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Chỉ hỗ trợ POST'})}
    if(typeof token!=='string'||token.length<32)return reply(res,503,{error:'Chưa cấu hình EXECUTOR_TOKEN trên Vercel'})
    const auth=String(req.headers.authorization||'');
    if(!timingSafeEqual(digest(auth),digest('Bearer '+token)))return reply(res,401,{error:'Mã executor không đúng'})
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return reply(res,415,{error:'Chỉ hỗ trợ JSON'})
    try{
      let job;
      if(req.body!==undefined){const text=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(text)>MAX_BYTES)return reply(res,413,{error:'Tác vụ quá lớn'});job=JSON.parse(text)}
      else{const parts=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>MAX_BYTES)return reply(res,413,{error:'Tác vụ quá lớn'});parts.push(part)}job=JSON.parse(Buffer.concat(parts).toString('utf8'))}
      const result=await runner(job);return reply(res,200,result);
    }catch(e){return reply(res,400,{error:String(e.message||'Không xử lý được tác vụ').slice(0,300)})}
  };
}
