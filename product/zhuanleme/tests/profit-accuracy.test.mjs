import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import { Ledger, categories } from '../src/ledger.mjs';
import { backupShop, inspectBackup, restoreShop } from '../src/backup.mjs';
const shop='accuracy',day='2026-09-01';
const rules=()=>categories.map(category=>({category,method:'daily',value:'0',effective:day}));
function fixture(fn){const l=new Ledger(':memory:');try{l.setRules(shop,rules());l.setSettings(shop,{channels:['store','meituan']});return fn(l);}finally{l.close();}}
const revenue=(l,extra={})=>l.add(shop,{day,kind:'revenue',channel:'store',amount:'1000',mode:'transaction',request:'income',...extra});
test('partial materials never replace a category estimate until explicitly completed',()=>fixture(l=>{
 l.setRules(shop,rules().map(r=>r.category==='materials'?{...r,method:'percent',value:'31.5',base:'all'}:r));revenue(l);
 assert.equal(l.report(shop,day).summary.profit,68500);
 const id=l.add(shop,{day,kind:'actual',category:'materials',amount:'20',request:'packaging',mode:'transaction'});
 let r=l.report(shop,day).summary;assert.equal(r.profit,null);assert.equal(r.costs[0].recordedAmount,2000);assert.deepEqual(r.partialCosts,['materials']);
 l.add(shop,{day,kind:'actual',category:'materials',amount:'295',costCoverage:'complete',request:'full-cost',mode:'transaction'});
 assert.equal(l.report(shop,day).summary.profit,68500);
 l.change(shop,{id,version:1,action:'void'});assert.equal(l.report(shop,day).summary.profit,70500);
 const late=l.add(shop,{day,kind:'actual',category:'materials',amount:'10',request:'late-detail',mode:'transaction'});
 assert.equal(l.report(shop,day).summary.profit,null);assert.equal(l.period(shop,day,day).totals.profit,null);
 l.change(shop,{id:late,version:1,action:'edit',costCoverage:'complete'});assert.equal(l.report(shop,day).summary.profit,69500);
}));
test('month-end payment replaces monthly accrual over its entire service period, with exact cents',()=>fixture(l=>{
 l.setRules(shop,rules().map(r=>r.category==='rent'?{...r,method:'monthly',value:'6000.01'}:r));
 assert.throws(()=>l.add(shop,{day:'2026-09-30',kind:'actual',category:'rent',amount:'6000.01',costCoverage:'complete',request:'ambiguous'}),/所属期间/);
 const id=l.add(shop,{day:'2026-10-05',kind:'actual',category:'rent',amount:'6000.01',costCoverage:'complete',costTiming:'period',costFrom:day,costTo:'2026-09-30',request:'rent'});
 const p=l.period(shop,day,'2026-09-30');assert.equal(p.totals.cost,600001);assert.equal(p.days[0].cost,20001);assert.equal(p.days[29].cost,20000);assert.equal(l.report(shop,day).summary.cost,20001);
 l.add(shop,{day:'2026-10-10',kind:'actual',category:'rent',amount:'300',refundOf:id,request:'rent-refund'});
 assert.equal(l.period(shop,day,'2026-09-30').totals.cost,570001);
 assert.equal(l.report(shop,'2026-10-05').summary.cost,19355);
}));
test('net settlement adds back known fees to revenue and deducts them exactly once',()=>fixture(l=>{
 l.setRules(shop,rules().map(r=>r.category==='platform'?{...r,method:'percent',value:'6',base:'meituan'}:r));
 assert.throws(()=>revenue(l,{channel:'meituan',revenueBasis:'net',amount:'940'}),/必须同时填写/);
 const id=revenue(l,{channel:'meituan',revenueBasis:'net',platformFee:'60',amount:'940'});
 let r=l.report(shop,day).summary;assert.equal(r.revenue,100000);assert.equal(r.cost,6000);assert.equal(r.profit,94000);
 assert.equal(l.period(shop,day,day).totals.profit,94000);
 assert.throws(()=>l.add(shop,{day,kind:'actual',category:'platform',amount:'60',request:'duplicate',costCoverage:'complete'}),/重复/);
 l.add(shop,{day:'2026-09-02',kind:'revenue',channel:'meituan',amount:'94',revenueBasis:'net',platformFee:'6',refundOf:id,request:'return'});
 r=l.report(shop,'2026-09-02').summary;assert.equal(r.revenue,-10000);assert.equal(r.cost,-600);assert.equal(r.profit,-9400);
 assert.equal(l.period(shop,day,'2026-09-02').totals.profit,84600);
 const edited={op:'change',id,version:1,action:'edit',amount:'1880',platformFee:'120',request:'edit-net'};
 const result=l.mutate(shop,edited);assert.equal(l.report(shop,day).summary.profit,188000);
 l.undo(shop,result.undo);assert.equal(l.report(shop,day).summary.profit,94000);
}));
test('gross channel fees can coexist with another channel net settlement; same-channel overlap rejects',()=>fixture(l=>{
 l.setRules(shop,rules().map(r=>r.category==='platform'?{...r,method:'percent',value:'6',base:'meituan'}:r));
 revenue(l,{channel:'meituan',revenueBasis:'net',platformFee:'60',amount:'940'});
 revenue(l,{channel:'douyin',amount:'1000',request:'douyin'});
 const fee=l.add(shop,{day,kind:'actual',category:'platform',amount:'30',feeChannel:'douyin',costCoverage:'complete',request:'dy-fee'});
 assert.equal(l.report(shop,day).summary.profit,191000);assert.equal(l.period(shop,day,day).totals.profit,191000);
 assert.throws(()=>l.add(shop,{day,kind:'actual',category:'platform',amount:'1',feeChannel:'meituan',request:'again'}),/重复/);
 l.change(shop,{id:fee,version:1,action:'edit',category:'materials'});assert.equal(l.row(shop,fee).feeChannel,undefined);assert.equal(l.report(shop,day).summary.profit,191000);
}));
test('profit distinguishes missing data, unreconciled income, estimates and verified actuals',()=>fixture(l=>{
 revenue(l);assert.equal(l.report(shop,day).summary.profitStatus,'provisional');
 l.closeDay(shop,day,['store','meituan']);assert.equal(l.report(shop,day).summary.profitStatus,'verified');
 for(const category of categories)l.add(shop,{day,kind:'actual',category,amount:'0',costCoverage:'complete',costTiming:'daily',request:category});
 l.closeDay(shop,day,['store','meituan']);assert.equal(l.report(shop,day).summary.profitStatus,'verified');
 assert.equal(l.period(shop,day,day).totals.profitStatus,'verified');
}));
test('schema 2 records and backups remain intact; new schema prevents unsafe old readers',()=>fixture(l=>{
 revenue(l);const data={day,kind:'actual',category:'materials',channel:null,amount:10000,note:'legacy',source:'manual'};
 l.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?)').run('legacy',shop,'legacy',JSON.stringify(data),'posted',1,new Date().toISOString());
 assert.equal(l.report(shop,day).summary.profit,90000);assert.equal(l.report(shop,day).summary.legacyCosts,true);
 assert.equal(l.db.prepare('SELECT data FROM entries WHERE id=?').get('legacy').data,JSON.stringify(data));
 assert.equal(l.db.prepare('PRAGMA user_version').get().user_version,3);
 const b=backupShop(l,shop);assert.equal(b.version,3);inspectBackup(b);
 const restored=new Ledger(':memory:');try{restoreShop(restored,'restored',b,b.checksum);assert.equal(restored.report('restored',day).summary.profit,90000);}finally{restored.close();}
}));
test('schema 2 upgrade preserves complete table contents and accepts the old JSON backup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zlm-v2-')),path=join(dir,'book.sqlite');let l=new Ledger(path);
 try{
  const old={day,kind:'actual',amount:1234,category:'rent',channel:null,note:'legacy rent',source:'manual'};
  l.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?)').run('old',shop,'old',JSON.stringify(old),'posted',1,'2026-09-01T00:00:00Z');
  l.db.prepare('INSERT INTO audit(shop,entry_id,action,data,created) VALUES(?,?,?,?,?)').run(shop,'old','posted',JSON.stringify(old),'2026-09-01T00:00:00Z');
  const before=l.db.prepare('SELECT * FROM entries').all();l.db.exec('PRAGMA user_version=2');l.close();l=new Ledger(path);assert.deepEqual(l.db.prepare('SELECT * FROM entries').all(),before);assert.equal(l.db.prepare('PRAGMA user_version').get().user_version,3);
  const b=backupShop(l,shop);b.version=2;const {checksum,...payload}=b;b.checksum=createHash('sha256').update(JSON.stringify(payload)).digest('hex');inspectBackup(b);
  const target=new Ledger(':memory:');try{restoreShop(target,'old-restore',b,b.checksum);assert.equal(target.rows('old-restore')[0].amount,1234);assert.equal(target.rows('old-restore')[0].costCoverage,undefined);}finally{target.close();}
 }finally{l.close();rmSync(dir,{recursive:true,force:true});}
});
test('later rules, fee refunds and recognition edits cannot introduce duplicate or unmatched fees',()=>fixture(l=>{
 const id=revenue(l,{channel:'meituan',amount:'940',revenueBasis:'net',platformFee:'60'});
 const version=l.rulesVersion(shop);assert.throws(()=>l.setRules(shop,rules().map(r=>r.category==='platform'?{...r,value:'60'}:r),version),/叠加/);assert.equal(l.rulesVersion(shop),version);
 l.add(shop,{day:'2026-09-02',kind:'revenue',channel:'meituan',revenueBasis:'net',amount:'1',platformFee:'60',refundOf:id,request:'fee-return'});
 assert.throws(()=>l.add(shop,{day:'2026-09-02',kind:'revenue',channel:'meituan',revenueBasis:'net',amount:'1',platformFee:'0.01',refundOf:id,request:'over-fee'}),/平台费/);
 assert.throws(()=>l.change(shop,{id,version:1,action:'edit',platformFee:'59'}),/关联退款/);
 assert.throws(()=>l.change(shop,{id,version:1,action:'edit',revenueBasis:'gross',platformFee:''}),/关联退款/);
}));
