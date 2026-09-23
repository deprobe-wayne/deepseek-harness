import { createHash, randomUUID } from 'node:crypto';
import { entry, rule } from './ledger.mjs';
const tables = ['entries','rules','audit','proposals','operations','shop_settings','day_closures'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** A transaction produces a consistent shop snapshot; chat transcripts are owned by DSH. */
export function backupShop(ledger, shop) {
    return ledger.transaction(() => {
        const data = Object.fromEntries(tables.map(table => [table, ledger.db.prepare(`SELECT * FROM ${table} WHERE shop=?`).all(shop)]));
        const payload = { format: 'zhuanleme-shop', version: 2, created: new Date().toISOString(), shop, data };
        return { ...payload, checksum: digest(payload) };
    });
}
export function inspectBackup(value) {
    if (!value || value.format !== 'zhuanleme-shop' || value.version !== 2 || typeof value.shop !== 'string') throw new Error('不支持的备份格式或版本');
    const {checksum,...payload} = value;
    if (checksum !== digest(payload)) throw new Error('备份校验失败，文件可能损坏');
    if (tables.some(t => !Array.isArray(value.data?.[t])) || tables.some(t=>value.data[t].length>200000)) throw new Error('备份数据不完整或过大');
    for (const row of value.data.entries) {
        if (row.shop !== value.shop || !row.id || !['posted','draft','void'].includes(row.status) || !Number.isSafeInteger(row.version) || row.version<1) throw new Error('备份账目无效');
        const data=JSON.parse(row.data); if(!Number.isSafeInteger(data.amount)||data.amount<0)throw new Error('备份金额无效'); entry({...data,amount:(data.amount/100).toFixed(2)});
    }
    for (const row of value.data.rules) { const data=JSON.parse(row.data); rule({...data,value:(data.value/100).toFixed(2)}); }
    return { created:value.created, entries:value.data.entries.length, rules:value.data.rules.length, audit:value.data.audit.length, proposals:value.data.proposals.length, checksum };
}
/** Restore only into an empty shop; an atomic rollback leaves existing shops untouched. */
export function restoreShop(ledger, shop, value, checksum) {
    const preview=inspectBackup(value);
    if (checksum!==preview.checksum) throw new Error('请先预览并确认备份');
    return ledger.transaction(()=>{
        if(tables.some(t=>ledger.db.prepare(`SELECT 1 FROM ${t} WHERE shop=? LIMIT 1`).get(shop))) throw new Error('只能恢复到全新空店铺，现有账本不会被覆盖');
        const ids=new Map([...value.data.entries,...value.data.proposals].map(r=>[r.id,randomUUID()]));
        const auditSeq=new Map(), ruleSeq=new Map();
        let auditNext=ledger.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM audit').get().n;
        let ruleNext=ledger.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM rules').get().n;
        for(const row of value.data.audit) auditSeq.set(row.seq,++auditNext);
        for(const row of value.data.rules) ruleSeq.set(row.seq,++ruleNext);
        const remap=(v,key='')=>{
            if(typeof v==='string') return ['id','target','refundOf','entry_id'].includes(key)?ids.get(v)||v:v;
            if(Array.isArray(v)) return v.map(item=>remap(item,key));
            if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x,k)]));
            if(['auditSeq','reverses','revision'].includes(key)) return auditSeq.get(v)||v;
            if(key==='seq') return ruleSeq.get(v)||v;
            return v;
        };
        for(const table of tables) for(const source of value.data[table]) {
            if(source.shop!==value.shop) throw new Error('备份店铺范围不一致');
            const row={...source,shop};
            if(row.id) row.id=ids.get(row.id);
            if(row.entry_id) row.entry_id=ids.get(row.entry_id)||row.entry_id;
            if(row.seq) row.seq=(table==='audit'?auditSeq:ruleSeq).get(row.seq);
            for(const field of ['data','result','fingerprint']) if(typeof row[field]==='string') {
                const parsed=JSON.parse(row[field]);
                // Rule proposal versions reference rules.seq, not entry versions.
                if((table==='proposals'||table==='audit')&&parsed.type==='rules'&&parsed.version) parsed.version=ruleSeq.get(parsed.version)||parsed.version;
                row[field]=JSON.stringify(remap(parsed));
            }
            const allowed=ledger.db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
            if(Object.keys(row).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in row))) throw new Error('备份表字段不匹配');
            ledger.db.prepare(`INSERT INTO ${table} (${allowed.join(',')}) VALUES(${allowed.map(()=>'?').join(',')})`).run(...allowed.map(k=>row[k]));
        }
        return {...preview, restored:true};
    });
}
