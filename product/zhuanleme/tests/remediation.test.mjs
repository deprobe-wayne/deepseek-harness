import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ledger} from '../src/ledger.mjs';
import {savePayload,tableRows} from '../src/client/ledger-table-model.mjs';
const day='2026-09-22', shop='a', add={op:'add',day,kind:'purchase',amount:'10',request:'new',note:''};
test('stable mutation receipts prevent replay from undoing a later model edit',()=>{
 const l=new Ledger(':memory:');try {
 const first=l.mutate(shop,add);
 l.change(shop,{id:first.id,version:1,action:'edit',day,kind:'purchase',amount:'20'});
 const replay=l.mutate(shop,add);assert.deepEqual(replay,first);
 assert.throws(()=>l.mutate(shop,{op:'undo',...replay.undo}),/新修改/);
 assert.equal(l.rows(shop)[0].amount,2000);
 }finally{l.close();}
});
test('edit responses replay exactly, while reused requests with other content fail',()=>{
 const l=new Ledger(':memory:');try {
 const {id}=l.mutate(shop,add), edit={op:'change',id,version:1,action:'edit',day,kind:'purchase',amount:'20',request:'edit'};
 const saved=l.mutate(shop,edit);assert.deepEqual(l.mutate(shop,edit),saved);
 assert.throws(()=>l.mutate(shop,{...edit,amount:'30'}),/同一提交/);
 const row=tableRows(l.report(shop,day).entries,day,'expenses')[0];
 assert.equal(savePayload({...row,amount:'30'},'next',k=>k).amount,'30');
 }finally{l.close();}
});
test('durable history recovers delete and successive edits, without blocking another entry',()=>{
 const l=new Ledger(':memory:');try {
 const {id}=l.mutate(shop,add);
 l.mutate(shop,{op:'change',id,version:1,action:'edit',day,kind:'purchase',amount:'20',request:'edit'});
 l.mutate(shop,{op:'change',id,version:2,action:'void'});
 let h=l.history(shop);assert.equal(h[0].action,'void');
 l.mutate(shop,{op:'undo',...h[0].undo});
 h=l.history(shop);assert.equal(h.find(x=>x.canUndo).action,'edit');
 l.mutate(shop,{op:'undo',...h.find(x=>x.canUndo).undo});
 assert.equal(l.rows(shop)[0].amount,1000);
 }finally{l.close();}
});
test('transactions accumulate while legacy summaries cannot be mixed, periods paginate',()=>{
 const l=new Ledger(':memory:');try {
 for(const [i,amount] of ['100','50'].entries()) l.add(shop,{...add,mode:'transaction',kind:'revenue',channel:'store',amount,request:'r'+i});
 assert.equal(l.report(shop,day).summary.revenue,15000);
 assert.throws(()=>l.add(shop,{...add,kind:'revenue',channel:'store',amount:'160',request:'summary'}),/汇总/);
 const period=l.period(shop,day,day,{limit:1});assert.equal(period.total,2);assert.equal(period.hasMore,true);assert.equal(period.totals.revenue,15000);
 l.setSettings(shop,{channels:['store','meituan']}); assert.equal(l.report(shop,day).summary.revenueComplete,false);
 l.closeDay(shop,day,['store','meituan']);assert.equal(l.report(shop,day).summary.revenueComplete,true);
 l.add(shop,{...add,mode:'transaction',kind:'revenue',channel:'store',request:'r3'});
 assert.equal(l.report(shop,day).summary.revenueComplete,false);
 }finally{l.close();}
});
import {backupShop,inspectBackup,restoreShop} from '../src/backup.mjs';
test('consistent backup restores into new shop and preserves undo, rejects corruption and overwrite',()=>{
 const a=new Ledger(':memory:'),b=new Ledger(':memory:');try {
 const {id}=a.mutate(shop,add);a.mutate(shop,{op:'change',id,version:1,action:'void'});
 const backup=backupShop(a,shop);assert.equal(inspectBackup(backup).entries,1);
 const corrupt=structuredClone(backup);corrupt.data.entries[0].status='posted';assert.throws(()=>inspectBackup(corrupt),/校验/);
 restoreShop(b,'new',backup,backup.checksum);
 assert.equal(b.rows('new')[0].status,'void');
 b.mutate('new',{op:'undo',...b.history('new').find(h=>h.canUndo).undo});
 assert.equal(b.rows('new')[0].status,'posted');
 assert.throws(()=>restoreShop(b,'new',backup,backup.checksum),/空店铺/);
 }finally{a.close();b.close();}
});
test('refunds reduce net revenue, require same-shop original and cannot exceed original',()=>{
 const l=new Ledger(':memory:');try{
 const id=l.add(shop,{...add,kind:'revenue',channel:'store',mode:'transaction',amount:'100'});
 const refund={...add,kind:'revenue',channel:'store',mode:'transaction',amount:'30',refundOf:id,request:'refund',time:'10:30',settlement:'paid',account:'现金'};
 l.add(shop,refund);assert.equal(l.report(shop,day).summary.revenue,7000);
 assert.equal(l.rows(shop)[0].time,'10:30');
 assert.throws(()=>l.add(shop,{...refund,amount:'80',request:'over'}),/超过/);
 assert.throws(()=>l.add('b',refund),/原账目/);
 assert.throws(()=>l.change(shop,{id,version:1,action:'void'}),/退款/);
 }finally{l.close();}
});
test('closed zero-revenue day produces zero percentage cost and changes reopen it',()=>{
 const l=new Ledger(':memory:');try{
 l.setSettings(shop,{channels:['store']});
 l.setRules(shop,['materials','labor','rent','utilities','platform','other'].map(category=>({category,method:'percent',value:'10',base:'all',effective:day})),0);
 l.closeDay(shop,day,['store']);
 assert.equal(l.report(shop,day).summary.revenue,0);assert.equal(l.report(shop,day).summary.cost,0);assert.equal(l.report(shop,day).summary.profit,0);
 }finally{l.close();}
});
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('v1 migration preserves old amounts, and persisted receipts survive restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zlm-migrate-')),path=join(dir,'ledger.sqlite');let l;
 try{
 l=new Ledger(path);const result=l.mutate(shop,add);l.db.exec('DROP TABLE operations; DROP TABLE shop_settings; DROP TABLE day_closures; PRAGMA user_version=1;');l.close();
 l=new Ledger(path);assert.equal(l.rows(shop)[0].amount,1000);assert.equal(l.db.prepare('PRAGMA user_version').get().user_version,2);
 // A pre-migration creation replay must still refer to its creation, not subsequent edits.
 l.change(shop,{id:result.id,version:1,action:'edit',day,kind:'purchase',amount:'20'});
 const replay=l.mutate(shop,add);assert.equal(replay.undo.version,1);assert.throws(()=>l.undo(shop,replay.undo));
 const edit={op:'change',id:result.id,version:2,action:'edit',day,kind:'purchase',amount:'30',request:'durable-edit'};
 const saved=l.mutate(shop,edit);l.close();l=new Ledger(path);assert.deepEqual(l.mutate(shop,edit),saved);
 }finally{l?.close();rmSync(dir,{recursive:true,force:true});}
});
test('indexed report excludes old history and period query enforces pagination bounds',()=>{
 const l=new Ledger(':memory:');try{
 l.transaction(()=>{const insert=l.db.prepare('INSERT INTO entries(id,shop,request,data,status,version,created) VALUES(?,?,?,?,?,?,?)');
 for(let i=0;i<10000;i++)insert.run('old'+i,shop,'old'+i,JSON.stringify({day:'2020-01-01',kind:'purchase',amount:100,category:null,channel:null,note:'old',source:'manual'}),'posted',1,'2020-01-01T00:00:00Z');});
 l.add(shop,add);assert.equal(l.report(shop,day).entries.length,1);
 const plan=l.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM entries WHERE shop=? AND json_extract(data,'$.day') BETWEEN ? AND ?").all(shop,day,day);
 assert(plan.some(r=>r.detail.includes('entries_shop_day')));
 assert.throws(()=>l.period(shop,day,day,{limit:501}));
 }finally{l.close();}
});

test('reconciliation refuses to omit channels that already contain receipts',()=>{
 const l=new Ledger(':memory:');try{
 l.add(shop,{...add,kind:'revenue',channel:'meituan',mode:'transaction'});
 l.setSettings(shop,{channels:['store']});assert.throws(()=>l.closeDay(shop,day,['store']),/其他渠道/);
 }finally{l.close();}
});
test('history pages retain old deleted entries beyond the first hundred operations',()=>{
 const l=new Ledger(':memory:');try{
 const {id}=l.mutate(shop,add);l.mutate(shop,{op:'change',id,version:1,action:'void'});
 for(let i=0;i<110;i++)l.mutate(shop,{...add,request:'later'+i});
 const first=l.history(shop);assert.equal(first.length,100);
 const older=l.history(shop,100,first.at(-1).seq);const deleted=older.find(h=>h.id===id&&h.action==='void');assert(deleted.canUndo);
 l.mutate(shop,{op:'undo',...deleted.undo});assert.equal(l.row(shop,id).status,'posted');
 }finally{l.close();}
});
test('backup into a second shop remaps audit, refunds, rules and pending proposals',()=>{
 const l=new Ledger(':memory:');try{
 const original=l.mutate(shop,{...add,kind:'revenue',channel:'store',mode:'transaction',amount:'100'});
 l.mutate(shop,{...add,kind:'revenue',channel:'store',mode:'transaction',amount:'20',refundOf:original.id,request:'refund'});
 l.setRules(shop,['materials','labor','rent','utilities','platform','other'].map(category=>({category,method:'daily',value:'0',effective:day})),0);
 l.propose(shop,{id:original.id,version:1,action:'edit',day,kind:'revenue',channel:'store',mode:'transaction',amount:'120',request:'proposal'});
 const backup=backupShop(l,shop);restoreShop(l,'restored',backup,backup.checksum);
 const rows=l.rows('restored'),refund=rows.find(r=>r.refundOf),parent=rows.find(r=>!r.refundOf);assert.equal(refund.refundOf,parent.id);assert.notEqual(parent.id,original.id);
 const proposal=l.proposals('restored')[0];assert.equal(proposal.target,parent.id);l.resolveProposal('restored',{id:proposal.id,action:'confirm'});
 assert.equal(l.report('restored',day).summary.revenue,10000);assert.equal(l.report(shop,day).summary.revenue,8000);
 const undo=l.history('restored').find(h=>h.canUndo);l.mutate('restored',{op:'undo',...undo.undo});assert.equal(l.report('restored',day).summary.revenue,8000);
 }finally{l.close();}
});

test('backup preserves user text that happens to equal an entry id',()=>{
 const l=new Ledger(':memory:');try{
 const id=l.add(shop,add);l.change(shop,{id,version:1,action:'edit',...add,note:id});
 const b=backupShop(l,shop);restoreShop(l,'copy',b,b.checksum);assert.equal(l.rows('copy')[0].note,id);assert.notEqual(l.rows('copy')[0].id,id);
 }finally{l.close();}
});
test('period pages expose drafts separately without adding them to financial totals',()=>{
 const l=new Ledger(':memory:');try{
 l.add(shop,{...add,request:'draft'},'draft');l.add(shop,add);
 const p=l.period(shop,day,day,{status:'draft'});assert.equal(p.entries.length,1);assert.equal(p.entries[0].status,'draft');assert.equal(p.totals.purchases,1000);
 }finally{l.close();}
});
