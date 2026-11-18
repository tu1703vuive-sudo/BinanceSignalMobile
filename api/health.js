module.exports=(_req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify({ok:true,version:'3.8.0',protocol:'paper-hybrid-v1',platform:'vercel',stateless:true,priceSource:'okx-spot',configured:typeof process.env.EXECUTOR_TOKEN==='string'&&process.env.EXECUTOR_TOKEN.length>=32}));
};
