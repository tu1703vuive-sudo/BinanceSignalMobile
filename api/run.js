const ready=import('../vercel/handler.mjs').then(({createHandler})=>createHandler());
module.exports=async(req,res)=>(await ready)(req,res);
