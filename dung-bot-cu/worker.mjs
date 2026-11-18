// Retirement deployment only. Keeps the old Durable Object namespace/data and stops its alarms.
const stopped=()=>new Response(JSON.stringify({ok:true,stopped:true,version:'3.9.0',message:'Paper trading đã dừng. App mới lấy Binance Futures trực tiếp.'}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export class PaperAccount{
  constructor(ctx){this.ctx=ctx}
  async alarm(){await this.ctx.storage.deleteAlarm()}
  async fetch(){await this.ctx.storage.deleteAlarm();return stopped()}
}
const account=env=>env.PAPER.get(env.PAPER.idFromName('paper-account-v1'));
export default {
  async fetch(_request,env){await account(env).fetch('https://internal/stop');return stopped()},
  async scheduled(_event,env){await account(env).fetch('https://internal/stop')}
};
