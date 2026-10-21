import { createHash, randomUUID } from 'node:crypto';
import { entry, storedEntryInput, rule, date, channels } from './ledger.mjs';
import { backupByteLimit, backupRowLimit } from './backup-limits.mjs';
const tables = ['entries','rules','audit','proposals','operations','shop_settings','day_closures'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checkCapacity(value) {
    if (tables.some(t=>!Array.isArray(value.data?.[t]))) throw new Error('备份数据不完整');
    if (tables.some(t=>value.data[t].length>backupRowLimit) || Buffer.byteLength(JSON.stringify(value,null,2),'utf8')>backupByteLimit) throw new Error('账本 JSON 备份超过 30 MiB 或单表 200000 条，请使用完整 Profile 备份');
}
const columns = {
    entries: ['id','shop','request','data','status','version','created'],
    rules: ['seq','shop','data'], audit: ['seq','shop','entry_id','action','data','created'],
    proposals: ['id','shop','request','data','status','created'],
    operations: ['shop','request','fingerprint','result'], shop_settings: ['shop','data'], day_closures: ['shop','day','data'],
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const identifier = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const parseObject = raw => { const value=JSON.parse(raw); if(!object(value)) throw new Error('备份记录格式无效'); return value; };
const validChannels = value => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(c=>channels.includes(c));
function checkEntry(data) {
    if (!object(data) || !Number.isSafeInteger(data.amount) || data.amount < 0) throw new Error('备份金额无效');
    if(data.platformFee!==undefined&&(!Number.isSafeInteger(data.platformFee)||data.platformFee<0))throw new Error('备份平台费用无效');
    const normalized=entry(storedEntryInput(data));
    if (data.category !== normalized.category || data.channel !== normalized.channel) throw new Error('备份账目分类无效');
    if (Object.hasOwn(data,'refundOf') && data.refundOf!==normalized.refundOf) throw new Error('备份退款标识无效');
}
function checkRule(data) {
    if (!object(data) || !Number.isSafeInteger(data.value) || data.value < 0) throw new Error('备份成本规则无效');
    rule({...data,value:(data.value/100).toFixed(2)});
}
/** Validate effective balances, recognition dates and references even with a recomputed checksum. */
function checkRelations(data) {
    const entries=new Map(), proposals=new Map(), audits=new Map(), ruleIds=new Set();
    for (const table of tables) {
        const keys=new Set(), requests=new Set();
        for (const row of data[table]) {
            if (!object(row) || Object.keys(row).length!==columns[table].length || columns[table].some(key=>!Object.hasOwn(row,key))) throw new Error('备份表字段不匹配');
            const key=row.id ?? row.seq ?? row.request ?? row.day ?? row.shop;
            if (keys.has(key)) throw new Error('备份包含重复记录');
            keys.add(key);
            if (Object.hasOwn(row,'id') && !identifier(row.id)) throw new Error('备份记录标识无效');
            if (Object.hasOwn(row,'seq') && !positive(row.seq)) throw new Error('备份历史序号无效');
            if (Object.hasOwn(row,'request')) {
                if (!identifier(row.request) || requests.has(row.request)) throw new Error('备份提交标识无效或重复');
                requests.add(row.request);
            }
            if (Object.hasOwn(row,'created') && (typeof row.created!=='string' || !Number.isFinite(Date.parse(row.created)))) throw new Error('备份创建时间无效');
        }
    }
    for (const row of data.entries) {
        if (!['posted','draft','void'].includes(row.status) || !positive(row.version)) throw new Error('备份账目无效');
        const value=parseObject(row.data);checkEntry(value);entries.set(row.id,{...value,id:row.id,status:row.status});
    }
    const groups=new Map(), refunds=new Map(), refundedFees=new Map();
    for (const row of entries.values()) {
        if (row.status!=='posted') continue;
        if (row.refundOf) {
            const parent=entries.get(row.refundOf);
            if (!parent || parent.status!=='posted' || parent.refundOf || parent.id===row.id || parent.kind!==row.kind || parent.category!==row.category || parent.channel!==row.channel || (parent.revenueBasis||'gross')!==(row.revenueBasis||'gross') || ['costFrom','costTo','feeChannel'].some(k=>(parent[k]??null)!==(row[k]??null))) throw new Error('备份退款必须关联本店同类型和同核算口径的有效原账目');
            const total=(refunds.get(parent.id)||0)+row.amount;
            if (!Number.isSafeInteger(total) || total>parent.amount) throw new Error('备份累计退款不能超过原账金额');
            refunds.set(parent.id,total);
            const fees=(refundedFees.get(parent.id)||0)+(row.platformFee||0);
            if(fees>(parent.platformFee||0))throw new Error('备份退回平台费超过原扣费');
            refundedFees.set(parent.id,fees);
        } else if (row.kind!=='purchase'&&!row.costFrom) {
            const key=JSON.stringify([row.day,row.kind,row.category,row.channel]), previous=groups.get(key);
            if (previous && (previous!=='transaction' || (row.mode||'summary')!=='transaction')) throw new Error('备份汇总记录不能重复或与逐笔记录混记');
            groups.set(key,row.mode||'summary');
        }
    }
    const netDays=new Map();
    for(const row of entries.values())if(row.status==='posted'&&row.revenueBasis==='net'){
        const dates=netDays.get(row.channel)||[];dates.push(row.day);netDays.set(row.channel,dates);
    }
    for(const dates of netDays.values())dates.sort();
    const platformRules=data.rules.map(row=>({...JSON.parse(row.data),seq:row.seq})).filter(row=>row.category==='platform').sort((a,b)=>b.effective.localeCompare(a.effective)||b.seq-a.seq);
    for(const dates of netDays.values())for(const day of dates){const rule=platformRules.find(row=>row.effective<=day);if(rule&&rule.method!=='percent'&&rule.value!==0)throw new Error('备份包含净到账与平台固定估算重复扣费');}
    for(const row of entries.values())if(row.status==='posted'&&row.kind==='actual'&&row.category==='platform'){
        const from=row.costFrom||row.day,to=row.costTo||row.day;
        for(const [channel,dates] of netDays){if(row.feeChannel&&row.feeChannel!==channel)continue;let lo=0,hi=dates.length;while(lo<hi){const mid=(lo+hi)>>1;if(dates[mid]<from)lo=mid+1;else hi=mid;}if(dates[lo]!==undefined&&dates[lo]<=to)throw new Error('备份包含净到账与手动平台费重复扣费');}
    }
    for (const row of data.rules) { checkRule(parseObject(row.data));ruleIds.add(row.seq); }
    for (const row of data.proposals) {
        if (entries.has(row.id) || !['pending','applied','rejected'].includes(row.status)) throw new Error('备份建议无效');
        const value=parseObject(row.data);
        if (value.type==='entry') {
            if (!entries.has(value.target) || !positive(value.version) || !['edit','void'].includes(value.action)) throw new Error('备份建议引用无效');
            checkEntry(value.before);
            if (value.action==='edit') checkEntry(value.entry);
        } else if (value.type==='rules') {
            if (!Number.isSafeInteger(value.version) || value.version<0 || (value.version!==0&&!ruleIds.has(value.version)) || !Array.isArray(value.rules) || !value.rules.length || value.rules.length>6 || new Set(value.rules.map(r=>r.category)).size!==value.rules.length || !Array.isArray(value.before)) throw new Error('备份成本建议无效');
            value.rules.forEach(checkRule);value.before.forEach(checkRule);
        } else throw new Error('备份建议类型无效');
        proposals.set(row.id,value);
    }
    for (const row of data.audit) {
        const value=JSON.parse(row.data);
        if (['posted','draft','edit','void','confirm','undo'].includes(row.action)) {
            if (!entries.has(row.entry_id)) throw new Error('备份历史引用无效');
            if (['posted','draft'].includes(row.action)) checkEntry(value);
            else {
                if (!object(value) || !['posted','draft','void'].includes(value.status) || !positive(value.before?.version) || value.before.id!==row.entry_id || !['posted','draft','void'].includes(value.before.status)) throw new Error('备份历史内容无效');
                checkEntry(value.before);checkEntry(value.after);
            }
        } else if (row.action==='rules') {
            if (row.entry_id!=='rules' || !Array.isArray(value)) throw new Error('备份规则历史无效');
            value.forEach(checkRule);
        } else if (['propose','applied','rejected'].includes(row.action)) {
            if (!proposals.has(row.entry_id) || !object(value)) throw new Error('备份建议历史引用无效');
        } else throw new Error('备份历史操作无效');
        audits.set(row.seq,{...row,value});
    }
    for (const row of audits.values()) if (row.action==='undo') {
        const original=audits.get(row.value.reverses);
        if (!original || original.entry_id!==row.entry_id || original.seq>=row.seq) throw new Error('备份撤销历史引用无效');
    }
    for (const row of data.operations) {
        const input=parseObject(row.fingerprint), result=parseObject(row.result), undo=result.undo;
        if (!['add','change','undo'].includes(input.op) || !entries.has(result.id) || !positive(result.version) || !object(undo) || undo.id!==result.id || undo.version!==result.version || audits.get(undo.auditSeq)?.entry_id!==result.id || (input.op!=='add'&&input.id!==result.id)) throw new Error('备份操作回执引用无效');
    }
    for (const row of data.shop_settings) if (!validChannels(parseObject(row.data).channels)) throw new Error('备份收入渠道无效');
    for (const row of data.day_closures) {
        date(row.day);const value=parseObject(row.data);
        if (!validChannels(value.channels) || !Number.isSafeInteger(value.revision) || value.revision<0 || (value.revision!==0&&!audits.has(value.revision)) || typeof value.at!=='string' || !Number.isFinite(Date.parse(value.at))) throw new Error('备份日结记录无效');
    }
}
/** Validate full SQLite snapshots without the smaller JSON export limits.
 * @param db Open snapshot database; only reads are performed.
 * @param shop Owner of the rows being validated.
 * @returns Nothing; invalid recognition, fee or reference data throws.
 */
export function validateLedgerDatabase(db, shop) {
    const data=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} WHERE shop=?`).all(shop)]));
    checkRelations(data);
}
/** A transaction produces a consistent shop snapshot; chat transcripts are owned by DSH. */
export function backupShop(ledger, shop) {
    return ledger.transaction(() => {
        const data = Object.fromEntries(tables.map(table => [table, ledger.db.prepare(`SELECT * FROM ${table} WHERE shop=?`).all(shop)]));
        const payload = { format: 'zhuanleme-shop', version: 3, created: new Date().toISOString(), shop, data };
        const backup = { ...payload, checksum: digest(payload) };
        checkCapacity(backup);
        return backup;
    });
}
export function inspectBackup(value) {
    if (!value || value.format !== 'zhuanleme-shop' || ![2,3].includes(value.version) || typeof value.shop !== 'string') throw new Error('不支持的备份格式或版本');
    checkCapacity(value);
    const {checksum,...payload} = value;
    if (checksum !== digest(payload)) throw new Error('备份校验失败，文件可能损坏');
    if (tables.some(table=>value.data[table].some(row=>!object(row)||row.shop!==value.shop))) throw new Error('备份店铺范围不一致');
    checkRelations(value.data);
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
        for(const row of [...value.data.audit].sort((a,b)=>a.seq-b.seq)) auditSeq.set(row.seq,++auditNext);
        for(const row of [...value.data.rules].sort((a,b)=>a.seq-b.seq)) ruleSeq.set(row.seq,++ruleNext);
        const remap=(v,key='')=>{
            if(typeof v==='string') return ['id','target','refundOf','entry_id'].includes(key)?ids.get(v)||v:v;
            if(Array.isArray(v)) return v.map(item=>remap(item,key));
            if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x,k)]));
            if(['auditSeq','reverses','revision'].includes(key)) return auditSeq.get(v)||v;
            if(key==='seq') return ruleSeq.get(v)||v;
            return v;
        };
        for(const table of tables) {
            const allowed=ledger.db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
            const insert=ledger.db.prepare(`INSERT INTO ${table} (${allowed.join(',')}) VALUES(${allowed.map(()=>'?').join(',')})`);
            for(const source of value.data[table]) {
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
            if(Object.keys(row).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in row))) throw new Error('备份表字段不匹配');
            insert.run(...allowed.map(k=>row[k]));
            }
        }
        ledger.checkPlatformRules(shop);
        return {...preview, restored:true};
    });
}
