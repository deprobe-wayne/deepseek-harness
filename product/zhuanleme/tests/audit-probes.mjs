/** Current regression probes. Historical pre-fix evidence is audit-probes.json. */
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.mjs';
import { tableRows, savePayload } from '../src/client/ledger-table-model.mjs';
const day='2026-09-22',shop='audit',checks=[];
const probe=(name,fn)=>{const l=new Ledger(':memory:');try{fn(l);checks.push({name,passed:true});}finally{l.close();}};
const purchase={day,kind:'purchase',amount:'10',request:'first',note:''};
probe('transaction accumulation',l=>{for(const [i,amount] of ['100','50'].entries())l.add(shop,{day,kind:'revenue',channel:'store',mode:'transaction',amount,request:String(i)});assert.equal(l.report(shop,day).summary.revenue,15000);});
probe('empty note table edit',l=>{l.add(shop,purchase);const row=tableRows(l.report(shop,day).entries,day,'expenses')[0];assert.equal(savePayload({...row,amount:'20'},'edit',x=>x).amount,'20');});
probe('revenue completeness',l=>{l.add(shop,{day,kind:'revenue',channel:'store',amount:'100',request:'r'});assert.equal(l.report(shop,day).summary.revenueComplete,false);});
probe('stable creation undo receipt',l=>{const input={...purchase,op:'add'},first=l.mutate(shop,input);l.change(shop,{...purchase,id:first.id,version:1,action:'edit',amount:'20'});assert.deepEqual(l.mutate(shop,input),first);assert.throws(()=>l.mutate(shop,{op:'undo',...first.undo}));});
probe('stable edit retry',l=>{const id=l.add(shop,purchase),edit={...purchase,op:'change',id,version:1,action:'edit',amount:'20',request:'edit'};assert.deepEqual(l.mutate(shop,edit),l.mutate(shop,edit));});
probe('refund and occurrence time',l=>{const id=l.add(shop,purchase);l.add(shop,{...purchase,amount:'3',request:'refund',refundOf:id,time:'11:45'});assert.equal(l.report(shop,day).summary.purchases,700);assert.equal(l.rows(shop)[0].time,'11:45');});
probe('period query',l=>{l.add(shop,purchase);l.add(shop,{...purchase,day:'2026-08-01',request:'old'});assert.equal(l.period(shop,'2026-08-01',day).total,2);});
console.log(JSON.stringify({checkedAt:new Date().toISOString(),scope:'Isolated post-remediation regression',checks},null,2));
