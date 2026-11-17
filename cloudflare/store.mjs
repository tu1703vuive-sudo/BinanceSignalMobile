export class Store{
  constructor(storage,now=Date.now){
    this.storage=storage;this.sql=storage.sql;this.now=now;this.readRows=0;this.writtenRows=0;
    for(const q of ["CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,json TEXT NOT NULL)","CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,json TEXT NOT NULL)","CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,subscription_id TEXT,payload TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending')","CREATE INDEX IF NOT EXISTS delivery_due ON deliveries(status,next_at)"])this.query(q);
    this.usage=this.get('usage')||{};this.rotate();
  }
  query(sql,...args){const c=this.sql.exec(sql,...args),rows=c.toArray();this.readRows+=c.rowsRead||0;this.writtenRows+=c.rowsWritten||0;return rows}
  get(key){const row=this.query('SELECT json FROM meta WHERE key=?',key)[0];return row?JSON.parse(row.json):null}
  put(key,value){this.query('INSERT INTO meta(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json',key,JSON.stringify(value))}
  atomic(fn){return this.storage.transactionSync(fn)}
  rotate(){const day=new Date(this.now()).toISOString().slice(0,10);if(this.usage.day!==day)this.usage={day,apiRequests:0,alarms:0,watchdogs:0,marketRequests:0,pushAttempts:0,sqlRowsReadObserved:0,sqlRowsWrittenObserved:0}}
  count(key,n=1){this.rotate();this.usage[key]=(this.usage[key]||0)+n}
  flushUsage(){this.rotate();this.usage.sqlRowsReadObserved+=this.readRows;this.usage.sqlRowsWrittenObserved+=this.writtenRows;this.readRows=0;this.writtenRows=0;this.put('usage',this.usage)}
  subscriptionCount(){return this.query('SELECT COUNT(*) AS n FROM subscriptions')[0].n}
  subscribe(id,sub){if(!this.query('SELECT id FROM subscriptions WHERE id=?',id).length&&this.subscriptionCount()>=5)throw new Error('Bản cá nhân hỗ trợ tối đa 5 thiết bị');this.query('INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',id,JSON.stringify(sub))}
  enqueue(payload){for(const s of this.query('SELECT id FROM subscriptions'))this.query("INSERT OR IGNORE INTO deliveries(id,subscription_id,payload,next_at) VALUES(?,?,?,?)",payload.id+'-'+s.id,s.id,JSON.stringify(payload),this.now())}
  pending(){return this.query("SELECT * FROM deliveries WHERE status='pending' AND next_at<=? ORDER BY next_at LIMIT 5",this.now())}
  nextDelivery(){return this.query("SELECT MIN(next_at) AS at FROM deliveries WHERE status='pending'")[0].at}
  cleanup(){this.query("DELETE FROM deliveries WHERE status!='pending' AND next_at<?",this.now()-7*86400000)}
}
