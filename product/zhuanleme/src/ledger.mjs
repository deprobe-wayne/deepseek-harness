import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { categories, LedgerError, summarize as calculateProfit } from './profit.mjs';
export { categories, LedgerError };
export const channels = ['store', 'meituan', 'douyin', 'other'];
export function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new LedgerError('请输入有效营业日期');
    return value;
}
export function cents(value) {
    if (typeof value !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(value.trim()))
        throw new LedgerError('金额须为非负数，最多两位小数');
    const [a, b = ''] = value.trim().split('.');
    return Number(a) * 100 + Number(b.padEnd(2, '0'));
}
export function text(value, max = 200) {
    if (typeof value !== 'string' || value.length > max)
        throw new LedgerError('文字过长或格式不正确');
    return value.trim();
}
export function entry(input) {
    const kind = input.kind;
    if (!['revenue', 'purchase', 'actual'].includes(kind))
        throw new LedgerError('请选择录入类型');
    if (kind === 'actual' && !categories.includes(input.category))
        throw new LedgerError('请选择成本项目');
    if (kind === 'revenue' && !channels.includes(input.channel))
        throw new LedgerError('请选择收入渠道');
    if (input.mode !== undefined && !['transaction','summary'].includes(input.mode)) throw new LedgerError('记账口径不正确');
    if (input.time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.time)) throw new LedgerError('请输入有效发生时间');
    if (input.settlement !== undefined && !['unknown','pending','paid'].includes(input.settlement)) throw new LedgerError('收付款状态不正确');
    const extra = { ...(input.details ? { details:text(input.details,200) } : {}), ...(input.refundOf ? { refundOf:text(input.refundOf,120) } : {}), ...(input.settlement ? {settlement:input.settlement}:{}), ...(input.account ? {account:text(input.account,80)}:{}) };
    if (input.costCoverage !== undefined) {
        if (kind !== 'actual' || !['partial','complete'].includes(input.costCoverage)) throw new LedgerError('请选择成本明细是否已录全');
        extra.costCoverage=input.costCoverage;
    }
    if (input.costFrom || input.costTo) {
        if (kind !== 'actual' || !input.costFrom || !input.costTo) throw new LedgerError('请填写完整费用所属期间');
        const from=date(input.costFrom),to=date(input.costTo),days=(Date.parse(to)-Date.parse(from))/86400000+1;
        if(days<1||days>366)throw new LedgerError('费用所属期间须为1至366天');
        extra.costFrom=from;extra.costTo=to;
    }
    if(input.costTiming!==undefined){if(kind!=='actual'||!['daily','period'].includes(input.costTiming))throw new LedgerError('成本所属时间不正确');if(input.costTiming==='period'&&!extra.costFrom)throw new LedgerError('按期间分摊的成本必须填写起止日期');if(input.costTiming==='daily'&&extra.costFrom)throw new LedgerError('单日成本不能同时填写分摊期间');extra.costTiming=input.costTiming;}
    if(input.feeChannel){if(kind!=='actual'||input.category!=='platform'||!channels.includes(input.feeChannel))throw new LedgerError('平台费用所属渠道不正确');extra.feeChannel=input.feeChannel;}
    if(input.revenueBasis!==undefined){if(kind!=='revenue'||!['gross','net'].includes(input.revenueBasis))throw new LedgerError('请选择扣费前营业额或平台净到账');extra.revenueBasis=input.revenueBasis;}
    if(input.revenueBasis==='net'){if(input.platformFee===undefined)throw new LedgerError('净到账必须同时填写本笔已扣平台费，确无费用请填0');extra.platformFee=cents(input.platformFee);}
    else if(input.platformFee!==undefined&&input.platformFee!=='')throw new LedgerError('平台已扣费用只用于净到账记录');
    return { ...extra, ...(input.mode ? { mode: input.mode } : {}), ...(input.time ? { time: input.time } : {}), day: date(input.day), kind, amount: cents(input.amount), category: kind === 'actual' ? input.category : null, channel: kind === 'revenue' ? input.channel : null, note: text(input.note ?? ''), source: input.source === 'ai' ? 'ai' : 'manual' };
}
export function rule(input) {
    if (!categories.includes(input.category))
        throw new LedgerError('请选择成本项目');
    if (!['monthly', 'percent', 'daily'].includes(input.method))
        throw new LedgerError('成本方法不正确');
    const value = cents(input.value);
    if (input.method === 'percent' && value > 10000)
        throw new LedgerError('比例不能超过 100%');
    if (input.method === 'percent' && !['all', ...channels].includes(input.base))
        throw new LedgerError('请选择比例计算基数');
    return { category: input.category, method: input.method, value, base: input.method === 'percent' ? input.base : null, effective: date(input.effective) };
}
// Remainder cents are allocated to the first days; a whole month sums exactly.
export function dailyShare(amount, day) {
    const [y, m, d] = day.split('-').map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Math.floor(amount / days) + (d <= amount % days ? 1 : 0);
}
export function summarize(day, rows, rules) {
    date(day);
    return calculateProfit(day,rows,rules);
}
/** Convert persisted integer cents to input without changing legacy optional fields.
 * @param row Persisted entry with integer amount and optional integer platform fee.
 * @returns Entry input with decimal money strings and unchanged recognition metadata.
 */
export const storedEntryInput = row => ({...row,amount:(row.amount/100).toFixed(2),...(row.platformFee!==undefined?{platformFee:(row.platformFee/100).toFixed(2)}:{})});
export class Ledger {
    constructor(path) {
        this.db = new DatabaseSync(path);
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        if (version > 3) { this.db.close(); throw new LedgerError('账本版本高于当前插件，请升级插件'); }
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, shop TEXT NOT NULL, request TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, UNIQUE(shop,request));
      CREATE TABLE IF NOT EXISTS rules (seq INTEGER PRIMARY KEY AUTOINCREMENT, shop TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, shop TEXT NOT NULL, entry_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, shop TEXT NOT NULL, request TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL, UNIQUE(shop,request));
      CREATE TABLE IF NOT EXISTS operations (shop TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(shop,request));
      CREATE INDEX IF NOT EXISTS entries_shop_day ON entries(shop,json_extract(data,'$.day'),status);
      CREATE INDEX IF NOT EXISTS entries_period_page ON entries(shop,status,json_extract(data,'$.day') DESC,created DESC);
      CREATE INDEX IF NOT EXISTS audit_shop_entry ON audit(shop,entry_id,seq);
      CREATE INDEX IF NOT EXISTS proposals_shop_status ON proposals(shop,status);
      CREATE TABLE IF NOT EXISTS shop_settings (shop TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS day_closures (shop TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(shop,day));
      PRAGMA user_version=3;`);
    }
    close() { this.db.close(); }
    transaction(fn, mode = 'IMMEDIATE') { if (this.inTransaction) return fn(); this.db.exec(mode === 'DEFERRED' ? 'BEGIN' : 'BEGIN IMMEDIATE'); this.inTransaction = true; try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        this.periodCache = undefined;
        throw e;
    } finally { this.inTransaction = false; } }
    row(shop,id) { const r=this.db.prepare('SELECT * FROM entries WHERE shop=? AND id=?').get(shop,id);return r?{...JSON.parse(r.data),id:r.id,status:r.status,version:r.version,created:r.created}:null; }
    rows(shop) { return this.db.prepare('SELECT *, (SELECT MAX(seq) FROM audit WHERE audit.shop=entries.shop AND entry_id=entries.id) AS coverageRevision FROM entries WHERE shop=? ORDER BY created DESC, rowid DESC').all(shop).map(r => ({ ...JSON.parse(r.data), coverageRevision:r.coverageRevision, id: r.id, status: r.status, version: r.version, created: r.created })); }
    rules(shop) { return this.db.prepare('SELECT * FROM rules WHERE shop=? ORDER BY seq').all(shop).map(r => ({ ...JSON.parse(r.data), seq: r.seq })); }
    checkRefunds(shop, next, except, status='posted') {
        if(!except&&!next.refundOf)return;
        const rows=this.db.prepare("SELECT * FROM entries WHERE shop=? AND (id=? OR json_extract(data,'$.refundOf')=? OR json_extract(data,'$.refundOf')=?)").all(shop,next.refundOf||'',except||'',next.refundOf||'').map(r=>({...JSON.parse(r.data),id:r.id,status:r.status,version:r.version})), dependents=except?rows.filter(r=>r.status==='posted'&&r.refundOf===except):[];
        if(dependents.length && (status==='void'||next.refundOf||dependents.some(r=>r.kind!==next.kind||r.channel!==next.channel||r.category!==next.category||(r.revenueBasis||'gross')!==(next.revenueBasis||'gross')||['costFrom','costTo','feeChannel'].some(k=>(r[k]??null)!==(next[k]??null)))||dependents.reduce((n,r)=>n+r.amount,0)>next.amount||dependents.reduce((n,r)=>n+(r.platformFee||0),0)>(next.platformFee||0))) throw new LedgerError('原账目存在退款，请先处理关联退款');
        if(status!=='posted'||!next.refundOf)return;
        const original=rows.find(r=>r.id===next.refundOf);
        if(!original||original.status!=='posted'||original.refundOf||original.id===except||original.kind!==next.kind||original.channel!==next.channel||original.category!==next.category||(original.revenueBasis||'gross')!==(next.revenueBasis||'gross')||['costFrom','costTo','feeChannel'].some(k=>(original[k]??null)!==(next[k]??null))) throw new LedgerError('退款必须关联本店同类型、同费用期间和同收入口径的有效原账目');
        const refunded=rows.filter(r=>r.id!==except&&r.status==='posted'&&r.refundOf===original.id).reduce((n,r)=>n+r.amount,0);
        if(refunded+next.amount>original.amount)throw new LedgerError('累计退款不能超过原账金额');
        const refundedFees=rows.filter(r=>r.id!==except&&r.status==='posted'&&r.refundOf===original.id).reduce((n,r)=>n+(r.platformFee||0),0);
        if(refundedFees+(next.platformFee||0)>(original.platformFee||0))throw new LedgerError('累计退回的平台费不能超过原扣费');
    }
    checkUnique(shop, next, except) { this.checkRefunds(shop,next,except); this.checkAccountingOverlap(shop,next,except); if (next.kind === 'purchase' || next.refundOf || next.costFrom)
        return; const conflict = this.db.prepare("SELECT * FROM entries WHERE shop=? AND json_extract(data,'$.day')=? AND status='posted'").all(shop,next.day).map(r=>({...JSON.parse(r.data),id:r.id,status:r.status})).find(r => r.id !== except && !r.refundOf && r.status === 'posted' && r.day === next.day && r.kind === next.kind && (next.kind === 'revenue' ? r.channel === next.channel : r.category === next.category) && ((r.mode || 'summary') !== 'transaction' || (next.mode || 'summary') !== 'transaction')); if (conflict)
        throw new LedgerError('该日该渠道/成本项目已有汇总记录，不能与逐笔记录混记；请修改原汇总或先转换口径'); }
    /** Automatic settlement fees and manual fees may never cover the same channel and day. */
    checkAccountingOverlap(shop,next,except) {
        if(next.kind==='revenue'&&next.revenueBasis!=='net')return;
        if(next.kind!=='revenue'&&!(next.kind==='actual'&&next.category==='platform'))return;
        const predicate=next.kind==='revenue'?"json_extract(data,'$.kind')='actual' AND json_extract(data,'$.category')='platform'":"json_extract(data,'$.kind')='revenue' AND json_extract(data,'$.revenueBasis')='net'";
        const rows=this.db.prepare(`SELECT id,data FROM entries WHERE shop=? AND status='posted' AND id<>? AND (${predicate})`).all(shop,except||'').map(r=>({...JSON.parse(r.data),id:r.id}));
        const overlap=(expense,sale)=>sale.day>=(expense.costFrom||expense.day)&&sale.day<=(expense.costTo||expense.day)&&(!expense.feeChannel||expense.feeChannel===sale.channel);
        if(next.kind==='revenue'&&next.revenueBasis==='net'){
            if(rows.some(r=>r.kind==='actual'&&r.category==='platform'&&overlap(r,next)))throw new LedgerError('本渠道已有平台费用，不能再通过净到账重复扣费；请修改原记录或撤销重复费用');
            const r=this.rules(shop).filter(r=>r.category==='platform'&&r.effective<=next.day).sort((a,b)=>b.effective.localeCompare(a.effective)||b.seq-a.seq)[0];
            if(r&&r.method!=='percent'&&r.value!==0)throw new LedgerError('净到账已包含平台费，请先将平台固定估算改为按渠道比例或明确为0');
        }
        if(next.kind==='actual'&&next.category==='platform'&&rows.some(r=>r.kind==='revenue'&&r.revenueBasis==='net'&&overlap(next,r)))throw new LedgerError('该渠道平台费已随净到账记录，不能重复录入；其他渠道费用请选择所属渠道');
    }
    audit(shop, id, action, data) { this.db.prepare('INSERT INTO audit(shop,entry_id,action,data,created) VALUES(?,?,?,?,?)').run(shop, id, action, JSON.stringify(data), new Date().toISOString()); }
    add(shop, input, status = 'posted') {
        const original=input.refundOf?this.row(shop,input.refundOf):null;
        const inherited=original?Object.fromEntries(['costCoverage','costFrom','costTo','costTiming','feeChannel','revenueBasis'].filter(k=>original[k]!==undefined).map(k=>[k,original[k]])):{};
        const next = entry({...inherited,...input,...(input.kind==='actual'&&input.costCoverage===undefined?{costCoverage:original?.costCoverage||'partial'}:{})}), request = text(input.request, 120);
        const activeRule=this.rules(shop).filter(r=>r.category===next.category&&r.effective<=next.day).sort((a,b)=>b.effective.localeCompare(a.effective)||b.seq-a.seq)[0];
        if (!request)
            throw new LedgerError('缺少提交标识');
        return this.transaction(() => {
            const old = this.db.prepare('SELECT * FROM entries WHERE shop=? AND request=?').get(shop, request);
            if (old) {
                // Edits update entries.data; the creation audit preserves the submitted operation.
                const original = this.db.prepare("SELECT data FROM audit WHERE shop=? AND entry_id=? AND action IN ('posted','draft') ORDER BY seq LIMIT 1").get(shop, old.id);
                if (!original) throw new LedgerError('原始提交记录缺失，无法核验重试');
                const submitted={...next}, saved=JSON.parse(original.data);
                if(input.costCoverage===undefined&&saved.costCoverage===undefined)delete submitted.costCoverage;
                if (original.data !== JSON.stringify(submitted))
                    throw new LedgerError('同一提交标识不能用于不同内容');
                return old.id;
            }
            if(next.kind==='actual'&&!next.costFrom&&!next.costTiming&&activeRule?.method==='monthly')throw new LedgerError('该成本按月分摊，请填写费用所属期间；确为单日成本请选择单日成本');
            if (status === 'posted')
                this.checkUnique(shop, next);
            const id = randomUUID();
            this.db.prepare('INSERT INTO entries(id,shop,request,data,status,created) VALUES(?,?,?,?,?,?)').run(id, shop, request, JSON.stringify(next), status, new Date().toISOString());
            this.audit(shop, id, status, next);
            return id;
        });
    }
    change(shop, input) {
        return this.transaction(() => this.changeInTransaction(shop, input));
    }
    /** Read an ordered selection belonging to one shop; missing or repeated ids reject the whole review. */
    reviewEntries(shop, ids) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string' || !id || id.length > 120) || new Set(ids).size !== ids.length)
            throw new LedgerError('请提供有效且不重复的核对账目');
        return ids.map(id => {
            const row = this.row(shop, id);
            if (!row) throw new LedgerError('核对记录不存在或不属于该店铺');
            return row;
        });
    }
    /** Confirm or discard the displayed draft versions atomically; an exact retry adds no audit records. */
    resolveEntries(shop, input) {
        if (!['confirm', 'reject'].includes(input.action) || !Array.isArray(input.items) || input.items.some(item => !item || !Number.isSafeInteger(item.version) || item.version < 1))
            throw new LedgerError('请选择有效的批量核对操作');
        const ids = input.items.map(item => item.id);
        return this.transaction(() => {
            this.reviewEntries(shop, ids);
            for (const item of input.items) {
                const row = this.row(shop, item.id);
                if (row.status !== 'draft' && row.version !== item.version + 1) throw new LedgerError('只有草稿可以批量核对，请刷新后再操作');
                this.changeInTransaction(shop, { ...item, action: input.action === 'confirm' ? 'confirm' : 'void' });
            }
            return { items: this.reviewEntries(shop, ids) };
        });
    }
    changeInTransaction(shop, input) {
            const old = this.row(shop,input.id);
            if (!old)
                throw new LedgerError('账目不存在');
            // Only replay the exact last confirmation/cancellation; later edits still invalidate it.
            if (['confirm', 'void'].includes(input.action) && old.version === input.version + 1) {
                const latest = this.db.prepare('SELECT action,data FROM audit WHERE shop=? AND entry_id=? ORDER BY seq DESC LIMIT 1').get(shop, old.id);
                if (latest?.action === input.action && JSON.parse(latest.data).before?.version === input.version)
                    return old.id;
            }
            if (old.version !== input.version)
                throw new LedgerError('账目已更新，请刷新后再操作');
            if (old.status === 'void')
                throw new LedgerError('账目已撤销');
            let next = entry(storedEntryInput(old)), status = old.status;
            if (input.action === 'void')
                status = 'void';
            else if (input.action === 'confirm') {
                if (old.status !== 'draft')
                    throw new LedgerError('只有草稿可以确认');
                status = 'posted';
            }
            else if (input.action === 'edit') {
                const previous=storedEntryInput(old);
                if(input.kind&&input.kind!==old.kind)for(const key of ['costCoverage','costTiming','costFrom','costTo','feeChannel','revenueBasis','platformFee'])delete previous[key];
                if(input.category&&input.category!=='platform')delete previous.feeChannel;
                if(input.revenueBasis==='gross'&&input.platformFee===undefined)delete previous.platformFee;
                if(input.costTiming==='daily'&&input.costFrom===undefined&&input.costTo===undefined){delete previous.costFrom;delete previous.costTo;}
                next = entry({ ...previous, ...input, source: old.source });
                if(next.kind==='actual'&&old.kind!=='actual'&&next.costCoverage===undefined)next.costCoverage='partial';
                if(next.kind==='actual'&&!next.costFrom&&!next.costTiming&&(next.amount!==old.amount||next.category!==old.category)){
                    const rule=this.rules(shop).filter(r=>r.category===next.category&&r.effective<=next.day).sort((a,b)=>b.effective.localeCompare(a.effective)||b.seq-a.seq)[0];
                    if(rule?.method==='monthly')throw new LedgerError('修改月付费用前请明确费用所属期间，或明确选择单日成本');
                }
            }
            else
                throw new LedgerError('操作不正确');
            this.checkRefunds(shop,next,old.id,status);
            if (status === 'posted')
                this.checkUnique(shop, next, old.id);
            this.db.prepare('UPDATE entries SET data=?,status=?,version=version+1 WHERE shop=? AND id=?').run(JSON.stringify(next), status, shop, old.id);
            this.audit(shop, old.id, input.action, { before: old, after: next, status });
            return old.id;
    }
    mutationResult(shop, id) {
        const row = this.row(shop,id);
        const event = this.db.prepare('SELECT seq FROM audit WHERE shop=? AND entry_id=? ORDER BY seq DESC LIMIT 1').get(shop, id);
        return { id, version: row.version, undo: { id, version: row.version, auditSeq: event.seq } };
    }
    /** Persist the exact response with the business request, never substitute a later audit. */
    mutate(shop, input) {
        const request = text(input.request || [input.op, input.id, input.version, input.action, input.auditSeq].join(':'), 200);
        const canonical = value => JSON.stringify(value, Object.keys(value).filter(k => !['shop', 'request'].includes(k)).sort());
        const fingerprint = canonical(input);
        return this.transaction(() => {
            const replay = this.db.prepare('SELECT * FROM operations WHERE shop=? AND request=?').get(shop, request);
            if (replay) {
                if (replay.fingerprint !== fingerprint) throw new LedgerError('同一提交标识不能用于不同内容');
                return JSON.parse(replay.result);
            }
            let id;
            if (input.op === 'add') id = this.add(shop, input);
            else if (input.op === 'change') id = this.change(shop, input);
            else if (input.op === 'undo') id = this.undo(shop, input);
            else throw new LedgerError('操作不正确');
            let result = this.mutationResult(shop, id);
            if (input.op === 'add') {
                const event = this.db.prepare("SELECT seq FROM audit WHERE shop=? AND entry_id=? AND action IN ('posted','draft') ORDER BY seq LIMIT 1").get(shop, id);
                result = { id, version: 1, undo: { id, version: 1, auditSeq: event.seq } };
            }
            this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(shop, request, fingerprint, JSON.stringify(result));
            return result;
        });
    }
    /** Current reversible operations are derived from durable audit, including earlier undos. */
    history(shop, limit = 100, before = Number.MAX_SAFE_INTEGER) {
        if(!Number.isSafeInteger(before)||before<1||!Number.isSafeInteger(limit)||limit<1||limit>100) throw new LedgerError('历史分页参数不正确');
        const events = this.db.prepare("SELECT a.* FROM audit a WHERE a.shop=? AND a.seq<? AND a.action IN ('posted','draft','edit','void','confirm') AND NOT EXISTS (SELECT 1 FROM audit u WHERE u.shop=a.shop AND u.entry_id=a.entry_id AND u.action='undo' AND json_extract(u.data,'$.reverses')=a.seq) ORDER BY a.seq DESC LIMIT ?").all(shop,before,limit);
        const ids=[...new Set(events.map(e=>e.entry_id))];
        const rows=new Map(ids.map(id=>{const r=this.db.prepare('SELECT * FROM entries WHERE shop=? AND id=?').get(shop,id);return [id,r?{...JSON.parse(r.data),id:r.id,status:r.status,version:r.version}:null];})), reversed=new Set();
        const normalize = row => JSON.stringify(entry(storedEntryInput(row)));
        const history = [];
        for (const event of events) {
            const record = JSON.parse(event.data);
            if (event.action === 'undo') { reversed.add(record.reverses); continue; }
            if (reversed.has(event.seq)) continue;
            const row = rows.get(event.entry_id), created = ['posted','draft'].includes(event.action);
            const expected = created ? record : record.after, status = created ? event.action : record.status;
            const latest = this.db.prepare('SELECT action,seq FROM audit WHERE shop=? AND entry_id=? ORDER BY seq DESC LIMIT 1').get(shop, event.entry_id);
            const canUndo = !!row && row.status === status && normalize(row) === normalize(expected) && (latest.seq === event.seq || latest.action === 'undo');
            history.push({ seq: event.seq, id: event.entry_id, action: event.action, created: event.created, note: (record.after || record).note || '', amount: (record.after || record).amount, canUndo, undo: canUndo ? { id: row.id, version: row.version, auditSeq: event.seq } : null });
            if (history.length >= limit) break;
        }
        return history;
    }
    /** Reverse an audited operation, guarded by both the current version and its saved result. */
    undo(shop, input) {
        return this.transaction(() => {
            const current = this.row(shop,input.id);
            const event = this.db.prepare('SELECT * FROM audit WHERE shop=? AND entry_id=? AND seq=?').get(shop, input.id, input.auditSeq);
            if (!current || !event || !['posted', 'draft', 'edit', 'void', 'confirm', 'undo'].includes(event.action)) throw new LedgerError('无法找到可撤销的操作');
            const latest = this.db.prepare('SELECT * FROM audit WHERE shop=? AND entry_id=? ORDER BY seq DESC LIMIT 1').get(shop, input.id);
            // A lost response can retry this exact reversal without reversing it twice.
            if (current.version === input.version + 1 && latest.action === 'undo' && JSON.parse(latest.data).reverses === input.auditSeq && JSON.parse(latest.data).before.version === input.version) return current.id;
            if (current.version !== input.version) throw new LedgerError('这笔账目已有新修改，无法撤销旧操作。请先核对最新数据。');
            const record = JSON.parse(event.data), created = ['posted', 'draft'].includes(event.action);
            const expected = created ? record : record.after, expectedStatus = created ? event.action : record.status;
            const normalize = row => entry(storedEntryInput(row));
            if (current.status !== expectedStatus || JSON.stringify(normalize(current)) !== JSON.stringify(normalize(expected))) throw new LedgerError('账目内容已变化，无法撤销旧操作');
            const next = normalize(created ? current : record.before), status = created ? 'void' : record.before.status;
            this.checkRefunds(shop,next,current.id,status);
            if (status === 'posted') this.checkUnique(shop, next, current.id);
            this.db.prepare('UPDATE entries SET data=?,status=?,version=version+1 WHERE shop=? AND id=?').run(JSON.stringify(next), status, shop, current.id);
            this.audit(shop, current.id, 'undo', { before: current, after: next, status, reverses: event.seq });
            return current.id;
        });
    }
    /** Browser edits supply the version captured when the rules form was opened. */
    setRules(shop, inputs, expectedVersion) {
        if (!Array.isArray(inputs) || inputs.length !== 6 || new Set(inputs.map(i => i.category)).size !== 6)
            throw new LedgerError('请填写六项成本规则');
        if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0))
            throw new LedgerError('需要查询当前成本规则版本后再修改');
        const next = inputs.map(rule);
        return this.transaction(() => {
            if (expectedVersion !== undefined && expectedVersion !== this.rulesVersion(shop))
                throw new LedgerError('成本规则已更新，请重新打开表单后修改');
            for (const r of next)
                this.db.prepare('INSERT INTO rules(shop,data) VALUES(?,?)').run(shop, JSON.stringify(r));
            this.checkPlatformRules(shop);
            this.audit(shop, 'rules', 'rules', next);
        });
    }
    /** Pending changes are separate from effective records; confirmation is one transaction. */
    proposals(shop) { return this.db.prepare('SELECT * FROM proposals WHERE shop=? ORDER BY created, rowid').all(shop).map(r => ({ ...JSON.parse(r.data), id: r.id, status: r.status, created: r.created })); }
    rulesVersion(shop) { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS version FROM rules WHERE shop=?').get(shop).version; }
    /** A new rule cannot add an overlapping fixed platform charge to net-settlement fees. */
    checkPlatformRules(shop) {
        const rules=this.rules(shop).filter(r=>r.category==='platform');
        const days=this.db.prepare("SELECT DISTINCT json_extract(data,'$.day') AS day FROM entries WHERE shop=? AND status='posted' AND json_extract(data,'$.revenueBasis')='net'").all(shop);
        for(const {day} of days){const rule=rules.filter(r=>r.effective<=day).sort((a,b)=>b.effective.localeCompare(a.effective)||b.seq-a.seq)[0];if(rule&&rule.method!=='percent'&&rule.value!==0)throw new LedgerError('该期间已有净到账及平台费，不能叠加平台固定估算；请使用按渠道比例或明确为0');}
    }
    propose(shop, input) {
        const request = text(input.request, 120);
        if (!request) throw new LedgerError('缺少提交标识');
        const payload = input.type === 'rules' ? { type: 'rules', version: input.version, rules: input.rules?.map(rule) }
            : { type: 'entry', target: input.id, version: input.version, action: input.action,
                ...(input.action === 'edit' ? { entry: entry({ ...input, source: 'ai' }) } : {}) };
        if (!Number.isSafeInteger(payload.version) || payload.version < 0) throw new LedgerError('需要查询当前版本后再修改');
        return this.transaction(() => {
            const previous = this.db.prepare('SELECT * FROM proposals WHERE shop=? AND request=?').get(shop, request);
            // Replay compares the proposed operation, not mutable before-state.
            if (previous) {
                const { before, ...saved } = JSON.parse(previous.data);
                if (JSON.stringify(saved) !== JSON.stringify(payload)) throw new LedgerError('同一提交标识不能用于不同内容');
                return { id: previous.id, status: previous.status };
            }
            let before;
            if (payload.type === 'rules') {
                if (!Array.isArray(payload.rules) || !payload.rules.length || payload.rules.length > 6 || new Set(payload.rules.map(r => r.category)).size !== payload.rules.length) throw new LedgerError('成本规则项目不能重复或为空');
                if (payload.version !== this.rulesVersion(shop)) throw new LedgerError('成本规则已更新，请重新查询');
                before = this.rules(shop);
            } else {
                if (!['edit', 'void'].includes(payload.action)) throw new LedgerError('只支持修改或撤销建议');
                before = this.row(shop,payload.target);
                if (!before || before.status === 'void') throw new LedgerError('账目不存在或已撤销');
                if (before.version !== payload.version) throw new LedgerError('账目已更新，请重新查询');
            }
            const id = randomUUID();
            this.db.prepare('INSERT INTO proposals(id,shop,request,data,created) VALUES(?,?,?,?,?)').run(id, shop, request, JSON.stringify({ ...payload, before }), new Date().toISOString());
            this.audit(shop, id, 'propose', payload);
            return { id, status: 'pending' };
        });
    }
    resolveProposal(shop, input) {
        if (!['confirm', 'reject'].includes(input.action)) throw new LedgerError('请选择确认或放弃');
        return this.transaction(() => {
            const row = this.db.prepare('SELECT * FROM proposals WHERE shop=? AND id=?').get(shop, input.id);
            if (!row) throw new LedgerError('修改建议不存在');
            const status = input.action === 'confirm' ? 'applied' : 'rejected';
            if (row.status === status) return { id: row.id, status }; // A lost HTTP response is safe to retry.
            if (row.status !== 'pending') throw new LedgerError('修改建议已处理');
            const p = JSON.parse(row.data);
            if (status === 'applied') {
                if (p.type === 'entry') {
                    this.changeInTransaction(shop, { ...(p.entry?storedEntryInput(p.entry):{}), id: p.target, version: p.version, action: p.action });
                } else {
                    if (p.version !== this.rulesVersion(shop)) throw new LedgerError('成本规则已更新，请放弃此建议并重新生成');
                    for (const r of p.rules) this.db.prepare('INSERT INTO rules(shop,data) VALUES(?,?)').run(shop, JSON.stringify(r));
                    this.checkPlatformRules(shop);
                    this.audit(shop, 'rules', 'rules', p.rules);
                }
            }
            this.db.prepare('UPDATE proposals SET status=? WHERE shop=? AND id=?').run(status, shop, row.id);
            this.audit(shop, row.id, status, p);
            return { id: row.id, status };
        });
    }
    settings(shop) {
        const row = this.db.prepare('SELECT data FROM shop_settings WHERE shop=?').get(shop);
        return row ? JSON.parse(row.data) : { channels: null };
    }
    setSettings(shop, input) {
        if (!Array.isArray(input.channels) || !input.channels.length || new Set(input.channels).size !== input.channels.length || input.channels.some(c => !channels.includes(c))) throw new LedgerError('请选择有效收入渠道');
        this.db.prepare('INSERT INTO shop_settings VALUES(?,?) ON CONFLICT(shop) DO UPDATE SET data=excluded.data').run(shop, JSON.stringify({ channels: input.channels }));
        return this.settings(shop);
    }
    closeDay(shop, day, reportedChannels) {
        date(day);
        const enabled = this.settings(shop).channels;
        if (!enabled || !Array.isArray(reportedChannels) || enabled.some(c => !reportedChannels.includes(c)) || reportedChannels.some(c => !enabled.includes(c))) throw new LedgerError('请核对所有已启用渠道；没有收入的渠道也需明确为零');
        const recorded = this.db.prepare("SELECT DISTINCT json_extract(data,'$.channel') AS channel FROM entries WHERE shop=? AND json_extract(data,'$.day')=? AND json_extract(data,'$.kind')='revenue' AND status='posted'").all(shop,day);
        if(recorded.some(r=>!enabled.includes(r.channel))) throw new LedgerError('当天已有其他渠道的收入，请将这些渠道一并核对');
        const data = { channels: reportedChannels, revision: this.revision(shop), at: new Date().toISOString() };
        this.db.prepare('INSERT INTO day_closures VALUES(?,?,?) ON CONFLICT(shop,day) DO UPDATE SET data=excluded.data').run(shop,day,JSON.stringify(data));
        return data;
    }
    revision(shop) { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM audit WHERE shop=?').get(shop).n; }
    daySummary(shop, day, rows, rules, context) {
        const settings = context ? context.settings : this.settings(shop);
        const closureRow = context ? null : this.db.prepare('SELECT data FROM day_closures WHERE shop=? AND day=?').get(shop, day);
        const closure = context ? context.closures.get(day) : closureRow ? JSON.parse(closureRow.data) : null;
        const changed = context ? context.changes.get(day) || 0 : this.db.prepare("SELECT MAX(seq) AS n FROM audit WHERE shop=? AND (json_extract(data,'$.day')=? OR json_extract(data,'$.before.day')=? OR json_extract(data,'$.after.day')=?)").get(shop, day, day, day).n || 0;
        const revenueComplete = !!settings.channels && !!closure && closure.revision >= changed && JSON.stringify([...settings.channels].sort()) === JSON.stringify([...closure.channels].sort());
        const zeros=revenueComplete?settings.channels.filter(c=>!rows.some(r=>r.day===day&&r.status==='posted'&&r.kind==='revenue'&&r.channel===c)).map(channel=>({day,kind:'revenue',channel,amount:0,status:'posted'})):[];
        const summary=summarize(day,[...rows,...zeros],rules);
        const profitStatus=summary.profit===null?'incomplete':!revenueComplete||summary.legacyCosts?'provisional':summary.estimated?'estimated':'verified';
        return { ...summary, profitStatus, revenueComplete, revenueStatus: !settings.channels ? 'unconfigured' : revenueComplete ? 'closed' : 'partial', enabledChannels: settings.channels };
    }
    /** SQL pages share one cached period summary; local writes and other connections invalidate it. */
    period(shop, from, to, { offset = 0, limit = 100, status = 'posted' } = {}) {
        date(from); date(to);
        const days = Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
        if (days < 1 || days > 366) throw new LedgerError('查询范围应为 1 至 366 天');
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new LedgerError('分页参数不正确');
        if(!['posted','draft','void'].includes(status))throw new LedgerError('账目状态不正确');
        return this.transaction(() => {
            const revision = this.revision(shop);
            const key = JSON.stringify([shop, from, to, this.db.prepare('SELECT total_changes() AS n').get().n, this.db.prepare('PRAGMA data_version').get().data_version]);
            if (this.periodCache?.key !== key) {
                const counts = Object.fromEntries(this.db.prepare("SELECT status,COUNT(*) AS n FROM entries WHERE shop=? AND json_extract(data,'$.day') BETWEEN ? AND ? GROUP BY status").all(shop,from,to).map(r=>[r.status,r.n]));
                // Transfer daily aggregates, not every entry body. Actual-cost ids retain report evidence.
                const aggregates = this.db.prepare(`SELECT json_extract(data,'$.day') AS day,
                    json_extract(data,'$.kind') AS kind, json_extract(data,'$.category') AS category,
                    json_extract(data,'$.channel') AS channel,
                    SUM(CASE WHEN json_extract(data,'$.refundOf') IS NOT NULL THEN -json_extract(data,'$.amount') ELSE json_extract(data,'$.amount') END) AS amount,
                    json_extract(data,'$.costCoverage') AS costCoverage,json_extract(data,'$.feeChannel') AS feeChannel,
                    MAX(CASE WHEN json_extract(data,'$.kind')='actual' THEN (SELECT MAX(seq) FROM audit a WHERE a.shop=entries.shop AND a.entry_id=entries.id) ELSE 0 END) AS coverageRevision,
                    json_extract(data,'$.revenueBasis') AS revenueBasis,
                    SUM(CASE WHEN json_extract(data,'$.refundOf') IS NOT NULL THEN -COALESCE(json_extract(data,'$.platformFee'),0) ELSE COALESCE(json_extract(data,'$.platformFee'),0) END) AS platformFee,
                    CASE WHEN json_extract(data,'$.kind')='actual' THEN json_group_array(id ORDER BY created DESC,rowid DESC) ELSE NULL END AS evidence
                    FROM entries WHERE shop=? AND status='posted' AND json_extract(data,'$.costFrom') IS NULL AND json_extract(data,'$.day') BETWEEN ? AND ?
                    GROUP BY json_extract(data,'$.day'),json_extract(data,'$.kind'),json_extract(data,'$.category'),json_extract(data,'$.channel'),json_extract(data,'$.costCoverage'),json_extract(data,'$.feeChannel'),json_extract(data,'$.revenueBasis')`).all(shop,from,to);
                const grouped = new Map();
                for (const row of aggregates) {
                    if (!grouped.has(row.day)) grouped.set(row.day,[]);
                    grouped.get(row.day).push({...row,costCoverage:row.costCoverage??undefined,status:'posted',...(row.evidence ? {evidence:JSON.parse(row.evidence)} : {})});
                }
                const periodCosts=this.db.prepare("SELECT id,data,(SELECT MAX(seq) FROM audit a WHERE a.shop=entries.shop AND a.entry_id=entries.id) AS coverageRevision FROM entries WHERE shop=? AND status='posted' AND json_extract(data,'$.kind')='actual' AND json_extract(data,'$.costFrom')<=? AND json_extract(data,'$.costTo')>=?").all(shop,to,from).map(row=>({...JSON.parse(row.data),coverageRevision:row.coverageRevision,id:row.id,status:'posted'}));
                const context = {
                    settings:this.settings(shop),
                    closures:new Map(this.db.prepare('SELECT day,data FROM day_closures WHERE shop=? AND day BETWEEN ? AND ?').all(shop,from,to).map(r=>[r.day,JSON.parse(r.data)])),
                    changes:new Map(this.db.prepare(`SELECT dates.value AS day,MAX(a.seq) AS revision FROM audit a,
                        json_each(json_array(json_extract(a.data,'$.day'),json_extract(a.data,'$.before.day'),json_extract(a.data,'$.after.day'))) dates
                        WHERE a.shop=? AND dates.value BETWEEN ? AND ? GROUP BY dates.value`).all(shop,from,to).map(r=>[r.day,r.revision])),
                };
                const rules = this.rules(shop), summaries = [];
                for (let i=0;i<days;i++) {
                    const d=new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10);
                    summaries.push(this.daySummary(shop,d,[...(grouped.get(d)||[]),...periodCosts],rules,context));
                }
                const totals = { revenue: summaries.every(s=>s.revenue!==null)?summaries.reduce((n,s)=>n+s.revenue,0):null, knownRevenue:summaries.reduce((n,s)=>n+(s.revenue||0),0), cost:summaries.every(s=>s.cost!==null)?summaries.reduce((n,s)=>n+s.cost,0):null, profit:summaries.every(s=>s.profit!==null)?summaries.reduce((n,s)=>n+s.profit,0):null, purchases:summaries.reduce((n,s)=>n+s.purchases,0), revenueComplete:summaries.every(s=>s.revenueComplete) };
                totals.estimated=summaries.some(s=>s.estimated);
                totals.profitStatus=totals.profit===null?'incomplete':summaries.some(s=>s.profitStatus==='provisional')?'provisional':totals.estimated?'estimated':'verified';
                totals.partialCosts=[...new Set(summaries.flatMap(s=>s.partialCosts))];
                // Keep only the most recently requested interval, regardless of shop count.
                this.periodCache = {key,counts,days:summaries,totals};
            }
            const entries = this.db.prepare("SELECT * FROM entries WHERE shop=? AND status=? AND json_extract(data,'$.day') BETWEEN ? AND ? ORDER BY json_extract(data,'$.day') DESC,created DESC,rowid DESC LIMIT ? OFFSET ?")
                .all(shop,status,from,to,limit,offset).map(r=>({...JSON.parse(r.data),id:r.id,status:r.status,version:r.version,created:r.created}));
            const total = this.periodCache.counts[status] || 0;
            return {revision,from,to,offset,limit,status,total,hasMore:offset+limit<total,entries,...structuredClone({days:this.periodCache.days,totals:this.periodCache.totals})};
        }, 'DEFERRED');
    }
    report(shop, day) {
        date(day);
        const from = new Date(Date.parse(day)-6*86400000).toISOString().slice(0,10);
        const rows = this.db.prepare("SELECT *, (SELECT MAX(seq) FROM audit a WHERE a.shop=entries.shop AND a.entry_id=entries.id) AS coverageRevision FROM entries WHERE shop=? AND (json_extract(data,'$.day') BETWEEN ? AND ? OR status='draft' OR (json_extract(data,'$.costFrom')<=? AND json_extract(data,'$.costTo')>=?)) ORDER BY created DESC,rowid DESC").all(shop,from,day,day,from).map(r=>({...JSON.parse(r.data),coverageRevision:r.coverageRevision,id:r.id,status:r.status,version:r.version,created:r.created}));
        const rules=this.rules(shop),trend=[];
        for(let i=0;i<7;i++) trend.push(this.daySummary(shop,new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10),rows,rules));
        return { summary:trend[6],trend,entries:rows.filter(r=>r.day===day||r.status==='draft'),rules,rulesVersion:this.rulesVersion(shop),proposals:this.proposals(shop).filter(p=>p.status==='pending'),history:this.history(shop,30),settings:this.settings(shop) };
    }
}
