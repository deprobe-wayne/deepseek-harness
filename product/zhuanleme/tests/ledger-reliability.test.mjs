import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, categories, summarize } from '../src/ledger.mjs';
import { backupShop, inspectBackup, restoreShop } from '../src/backup.mjs';
import { backupByteLimit, backupRowLimit } from '../src/backup-limits.mjs';

const day='2026-10-14', previous='2026-10-13', shop='source';
const purchase={day,kind:'purchase',mode:'transaction',amount:'10',request:'purchase'};
const rules=(value='10')=>categories.map(category=>({category,method:category==='platform'?'percent':'daily',value:category==='platform'?value:'0',base:'all',effective:previous}));
const reseal=backup=>{const {checksum,...payload}=backup;backup.checksum=createHash('sha256').update(JSON.stringify(payload)).digest('hex');return backup;};
function fixture() {
    const ledger=new Ledger(':memory:');
    const original=ledger.mutate(shop,{op:'add',day:previous,kind:'revenue',channel:'store',mode:'transaction',amount:'100',request:'sale'});
    ledger.mutate(shop,{op:'add',day,kind:'revenue',channel:'store',mode:'transaction',amount:'30',refundOf:original.id,request:'refund'});
    ledger.setRules(shop,rules(),0);
    ledger.setSettings(shop,{channels:['store']});
    ledger.closeDay(shop,day,['store']);
    ledger.propose(shop,{id:original.id,version:1,action:'void',request:'proposal'});
    return ledger;
}
function editEntry(backup, predicate, change) {
    const row=backup.data.entries.find(row=>predicate(JSON.parse(row.data)));
    row.data=JSON.stringify({...JSON.parse(row.data),...change});
}

test('percentage costs round both signs symmetrically, including exact and half cents',()=>{
    for(const [amount,rate,expected] of [[10000,1000,1000],[1,5000,1],[1,4900,0],[3,5000,2],[99999999999,9999,99989999999]]) {
        for(const sign of [1,-1]) {
            const summary=summarize(day,[{id:'sale',day,kind:'revenue',channel:'store',status:'posted',amount,...(sign<0?{refundOf:'earlier'}:{})}],
                [{category:'platform',method:'percent',value:rate,base:'all',effective:previous,seq:1}]);
            assert.equal(summary.costs.find(c=>c.category==='platform').amount,expected===0?0:sign*expected);
        }
    }
});

const invalidBackups=[
    ['excess refund',b=>editEntry(b,e=>!!e.refundOf,{amount:20000})],
    ['cumulative excess refunds',b=>{const r=structuredClone(b.data.entries.find(r=>JSON.parse(r.data).refundOf));r.id='refund2';r.request='refund2';r.data=JSON.stringify({...JSON.parse(r.data),amount:8000});b.data.entries.push(r);}],
    ['orphan refund',b=>editEntry(b,e=>!!e.refundOf,{refundOf:'missing'})],
    ['empty refund identifier',b=>editEntry(b,e=>!!e.refundOf,{refundOf:''})],
    ['refund of itself',b=>{const r=b.data.entries.find(r=>JSON.parse(r.data).refundOf);editEntry(b,e=>!!e.refundOf,{refundOf:r.id});}],
    ['refund of void entry',b=>{b.data.entries.find(r=>!JSON.parse(r.data).refundOf).status='void';}],
    ['wrong refund channel',b=>editEntry(b,e=>!!e.refundOf,{channel:'meituan'})],
    ['duplicate summary',b=>{const r=structuredClone(b.data.entries.find(r=>!JSON.parse(r.data).refundOf));r.id='duplicate';r.request='duplicate';r.data=JSON.stringify({...JSON.parse(r.data),mode:'summary'});b.data.entries.push(r);}],
    ['cross-shop record',b=>{b.data.audit[0].shop='other';}],
    ['duplicate identifier',b=>{b.data.entries.push(structuredClone(b.data.entries[0]));}],
    ['orphan proposal',b=>{const p=b.data.proposals[0];p.data=JSON.stringify({...JSON.parse(p.data),target:'missing'});}],
    ['orphan history',b=>{b.data.audit[0].entry_id='missing';}],
    ['orphan receipt',b=>{const r=b.data.operations[0];const v=JSON.parse(r.result);v.undo.auditSeq=999999;r.result=JSON.stringify(v);}],
    ['invalid day close',b=>{const r=b.data.day_closures[0];r.data=JSON.stringify({...JSON.parse(r.data),channels:['unknown']});}],
];
for(const [name,corrupt] of invalidBackups) test(`backup preview and restore reject ${name} even with matching checksum`,()=>{
    const source=fixture(), target=new Ledger(':memory:');
    try {
        target.add('existing',{...purchase,request:'existing'});
        const backup=backupShop(source,shop);corrupt(backup);reseal(backup);
        assert.throws(()=>inspectBackup(backup));
        assert.throws(()=>restoreShop(target,'new',backup,backup.checksum));
        for(const table of Object.keys(backup.data)) assert.equal(target.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE shop=?`).get('new').n,0);
        assert.equal(target.rows('existing')[0].amount,1000);
    } finally {source.close();target.close();}
});

test('valid backup preserves refunds, stale proposals, channel closure and reversible history',()=>{
    const source=fixture(), target=new Ledger(':memory:');
    try {
        const original=source.rows(shop).find(r=>r.request==='sale'||(r.kind==='revenue'&&!r.refundOf));
        source.change(shop,{id:original.id,version:original.version,action:'edit',amount:'120'});
        const p=source.mutate(shop,{op:'add',...purchase});
        source.mutate(shop,{op:'change',id:p.id,version:1,action:'void',request:'delete'});
        const backup=backupShop(source,shop);
        backup.data.rules.reverse();backup.data.audit.reverse();reseal(backup);
        assert.equal(inspectBackup(backup).entries,3);
        restoreShop(target,'new',backup,backup.checksum);
        assert.equal(target.period('new',day,day).totals.knownRevenue,-3000);
        assert.equal(target.period('new',day,day).days[0].costs.find(c=>c.category==='platform').amount,-300);
        const h=target.history('new').find(h=>h.action==='void'&&h.canUndo);
        target.mutate('new',{op:'undo',...h.undo});
        assert.equal(target.period('new',day,day).totals.purchases,1000);
        assert.equal(inspectBackup(backupShop(target,'new')).entries,3);
    } finally {source.close();target.close();}
});

test('restore rolls back all tables after a mid-import database failure',()=>{
    const source=fixture(),target=new Ledger(':memory:');
    try {
        const backup=backupShop(source,shop);
        target.db.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON proposals BEGIN SELECT RAISE(ABORT,'injected failure'); END");
        assert.throws(()=>restoreShop(target,'new',backup,backup.checksum),/injected failure/);
        for(const table of Object.keys(backup.data)) assert.equal(target.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
    } finally {source.close();target.close();}
});

test('period totals match daily reports across refunds, overrides, missing days and leap day',()=>{
    const l=fixture();
    try {
        l.add(shop,{...purchase,kind:'actual',category:'materials',request:'cost'});
        l.add(shop,{...purchase,kind:'actual',category:'materials',amount:'20',request:'cost2'});
        l.add(shop,{...purchase,request:'draft'},'draft');
        const result=l.period(shop,previous,'2026-10-15',{limit:1});
        assert.deepEqual(result.days,[previous,day,'2026-10-15'].map(d=>l.report(shop,d).summary));
        assert.equal(result.totals.knownRevenue,7000);
        assert.equal(result.totals.revenue,null);
        assert.equal(result.totals.profit,null);
        assert.deepEqual(l.period(shop,previous,'2026-10-15',{status:'draft'}).totals,result.totals);
        assert.deepEqual(l.period('empty','2024-02-28','2024-03-01').days.map(d=>d.day),['2024-02-28','2024-02-29','2024-03-01']);
    } finally {l.close();}
});

test('large period pages read bounded entry bodies and reuse aggregates for unchanged data',()=>{
    const l=new Ledger(':memory:');
    try {
        l.transaction(()=>{
            const insert=l.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?)');
            for(let i=0;i<12000;i++) insert.run('id-'+i,shop,'r-'+i,JSON.stringify({...purchase,amount:100,category:null,channel:null,note:'item',source:'manual'}),'posted',1,'2026-10-14T00:00:00Z');
        });
        const prepare=l.db.prepare.bind(l.db), reads=[];
        l.db.prepare=sql=>{
            const statement=prepare(sql);
            return new Proxy(statement,{get(target,key){
                if(key==='all') return (...args)=>{const rows=target.all(...args);reads.push({sql,count:rows.length});return rows;};
                const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
            }});
        };
        const first=l.period(shop,day,day,{limit:500});
        assert.equal(first.total,12000);assert.equal(first.totals.purchases,1200000);
        first.days[0].purchases=0;first.totals.purchases=0;
        const firstReads=reads.length;
        const second=l.period(shop,day,day,{offset:500,limit:500});
        assert.equal(second.entries.length,500);assert.equal(second.totals.purchases,1200000);
        assert.equal(second.days[0].purchases,1200000);
        assert(!second.entries.some(row=>first.entries.some(old=>old.id===row.id)));
        assert(reads.filter(r=>/SELECT \* FROM entries/.test(r.sql)).every(r=>/LIMIT \? OFFSET \?/.test(r.sql)&&r.count<=500));
        assert(!reads.slice(firstReads).some(r=>/GROUP BY|FROM audit a/.test(r.sql)));
        assert.equal(l.period(shop,day,day,{offset:12000,limit:500}).hasMore,false);
        const plan=prepare("EXPLAIN QUERY PLAN SELECT * FROM entries WHERE shop=? AND status=? AND json_extract(data,'$.day') BETWEEN ? AND ? ORDER BY json_extract(data,'$.day') DESC,created DESC,rowid DESC LIMIT ? OFFSET ?").all(shop,'posted',day,day,500,500);
        assert(plan.some(r=>r.detail.includes('entries_period_page')));
    } finally {l.close();}
});

test('period cache sees settings, closures, edits, rules, undo, restore and rolled-back writes',()=>{
    const l=new Ledger(':memory:');
    try {
        l.setRules(shop,rules(),0);l.period(shop,day,day);
        l.setSettings(shop,{channels:['store']});
        assert.deepEqual(l.period(shop,day,day).days[0].enabledChannels,['store']);
        l.closeDay(shop,day,['store']);
        assert.equal(l.period(shop,day,day).totals.revenue,0);
        const sale=l.mutate(shop,{op:'add',day,kind:'revenue',channel:'store',mode:'transaction',amount:'100',request:'sale'});
        assert.equal(l.period(shop,day,day).totals.revenue,10000);
        assert.equal(l.period(shop,day,day).totals.revenueComplete,false);
        l.setRules(shop,rules('20'),l.rulesVersion(shop));
        assert.equal(l.period(shop,day,day).totals.cost,2000);
        const edit=l.mutate(shop,{op:'change',id:sale.id,version:1,action:'edit',amount:'200',request:'edit'});
        assert.equal(l.period(shop,day,day).totals.revenue,20000);
        l.mutate(shop,{op:'undo',...edit.undo});
        assert.equal(l.period(shop,day,day).totals.revenue,10000);
        assert.throws(()=>l.transaction(()=>{l.add(shop,purchase);assert.equal(l.period(shop,day,day).totals.purchases,1000);throw new Error('rollback');}),/rollback/);
        assert.equal(l.period(shop,day,day).totals.purchases,0);
        const backup=backupShop(l,shop);l.period('restored',day,day);
        restoreShop(l,'restored',backup,backup.checksum);
        assert.equal(l.period('restored',day,day).totals.revenue,10000);
    } finally {l.close();}
});

test('period cache observes commits from a second database connection',()=>{
    const dir=mkdtempSync(join(tmpdir(),'zlm-period-')),path=join(dir,'ledger.sqlite');
    const a=new Ledger(path),b=new Ledger(path);
    try {
        assert.equal(a.period(shop,day,day).total,0);
        b.add(shop,purchase);
        assert.equal(a.period(shop,day,day).total,1);
        b.setSettings(shop,{channels:['store']});b.closeDay(shop,day,['store']);
        assert.equal(a.period(shop,day,day).totals.revenueComplete,true);
    } finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test('backup export and preview apply the same row and formatted UTF-8 size limits',()=>{
    const source=fixture();
    try {
        const backup=backupShop(source,shop);
        const fakeLedger={transaction:fn=>fn(),db:{prepare(sql){const table=sql.match(/FROM (\w+)/)[1];return {all:()=>backup.data[table]};}}};
        const original=backup.data.operations;
        backup.data.operations=Array(backupRowLimit+1).fill(original[0]);
        assert.throws(()=>backupShop(fakeLedger,shop),/200000/);
        assert.throws(()=>inspectBackup(reseal(backup)),/200000/);
        backup.data.operations=original;
        const row=backup.data.entries[0];
        row.data=JSON.stringify({...JSON.parse(row.data),note:'中'.repeat(Math.ceil(backupByteLimit/3))});
        assert.throws(()=>backupShop(fakeLedger,shop),/30 MiB/);
        assert.throws(()=>inspectBackup(reseal(backup)),/30 MiB/);
    } finally {source.close();}
});
