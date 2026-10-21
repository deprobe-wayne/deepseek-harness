/** Deterministic operating-cost recognition, independent of models and payment dates. */
export const categories = ['materials', 'labor', 'rent', 'utilities', 'platform', 'other'];
/** A user-correctable ledger validation failure; its message contains no paths or credentials. */
export class LedgerError extends Error {}
const sign = row => row.refundOf ? -1 : 1;
const ratio = (base, rate) => {
    const value = BigInt(base) * BigInt(rate), absolute = value < 0n ? -value : value;
    return Number((value < 0n ? -1n : 1n) * ((absolute + 5000n) / 10000n));
};
const gross = row => row.amount + (row.revenueBasis === 'net' ? row.platformFee : 0);
const latest = (rules, category, day) => rules.filter(r => r.category === category && r.effective <= day).sort((a,b) => b.effective.localeCompare(a.effective) || b.seq-a.seq)[0];
/** Allocate a fixed total over an inclusive period; early days receive remainder cents.
 * @param amount Nonnegative integer cents for the entire service period.
 * @param from Inclusive service start date.
 * @param to Inclusive service end date.
 * @param day Recognition date; outside dates return zero.
 * @returns Integer cents recognized on this date.
 */
export function periodShare(amount, from, to, day) {
    if (day < from || day > to) return 0;
    const count = Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
    const index = Math.round((Date.parse(day)-Date.parse(from))/86400000);
    return Math.floor(amount/count) + (index < amount%count ? 1 : 0);
}
function estimated(rule, day, sales, excluded = new Set()) {
    if (!rule) return null;
    if (rule.value === 0) return 0;
    if (rule.method === 'daily') return rule.value;
    if (rule.method === 'monthly') {
        const end = new Date(Date.UTC(Number(day.slice(0,4)), Number(day.slice(5,7)), 0)).toISOString().slice(0,10);
        return periodShare(rule.value, day.slice(0,8)+'01', end, day);
    }
    const eligible = sales.filter(row => !excluded.has(row.channel) && (rule.base === 'all' || row.channel === rule.base));
    return eligible.length ? ratio(eligible.reduce((n,row) => n+sign(row)*gross(row),0),rule.value) : null;
}
function actualCost(rows, category) {
    const recordedAmount = rows.reduce((n,row) => n+sign(row)*row.amount,0);
    const latest=rows.reduce((last,row)=>(row.coverageRevision||0)>(last.coverageRevision||0)?row:last,rows[0]);
    const ordered=rows.every(row=>Number.isSafeInteger(row.coverageRevision)&&row.coverageRevision>0);
    const complete = ordered ? latest.costCoverage!=='partial' : rows.every(row=>row.costCoverage!=='partial');
    return { category, amount:complete ? recordedAmount : null, recordedAmount, knownAmount:recordedAmount,
        basis:complete ? 'actual' : 'incomplete', legacy:complete&&(ordered?latest.costCoverage===undefined:rows.some(row=>row.costCoverage===undefined)),
        evidence:rows.flatMap(row => row.evidence ?? [row.id]) };
}
/** Only posted rows count. Partial actuals cannot silently replace a complete estimate.
 * @param day Validated business date.
 * @param rows Persisted rows or SQL aggregates, including overlapping service periods.
 * @param rules Ordered cost rules with effective dates and integer values.
 * @returns Daily amounts, cost evidence and completeness; unknown profit remains null.
 */
export function summarize(day, rows, rules) {
    const active = rows.filter(row => row.status === 'posted').flatMap(row => {
        if (row.kind === 'actual' && row.costFrom) return day >= row.costFrom && day <= row.costTo ? [{...row,day,amount:periodShare(row.amount,row.costFrom,row.costTo,day)}] : [];
        return row.day === day ? [row] : [];
    });
    const sales = active.filter(row => row.kind === 'revenue');
    const revenue = sales.length ? sales.reduce((n,row) => n+sign(row)*gross(row),0) : null;
    const autoFee = sales.filter(row => row.revenueBasis === 'net').reduce((n,row) => n+sign(row)*row.platformFee,0);
    const costs = categories.map(category => {
        const actuals = active.filter(row => row.kind === 'actual' && row.category === category);
        const rule = latest(rules,category,day);
        if (category !== 'platform') {
            if (actuals.length) return actualCost(actuals,category);
            const amount = estimated(rule,day,sales);
            return {category,amount,basis:amount===null?'missing':rule.method,...(rule?{rule}:{})};
        }
        if (actuals.some(row => !row.feeChannel)) return actualCost(actuals,category);
        const scoped = [...new Set(actuals.map(row => row.feeChannel))];
        const groups = scoped.map(channel => actualCost(actuals.filter(row => row.feeChannel === channel),category));
        // Net settlements carry their exact fee; percentage estimates apply only to gross-only records.
        const eligible = sales.filter(row => row.revenueBasis !== 'net');
        let estimate = estimated(rule,day,eligible,new Set(scoped));
        if (rule?.method === 'percent' && !eligible.some(row => !scoped.includes(row.channel) && (rule.base === 'all' || row.channel===rule.base)) && (sales.some(row=>row.revenueBasis==='net'&&(rule.base==='all'||row.channel===rule.base)) || scoped.includes(rule.base) || rule.base==='all'&&groups.length)) estimate=0;
        if (!rule && (groups.length || sales.some(row=>row.revenueBasis==='net')) && !eligible.some(row=>!scoped.includes(row.channel)&&row.amount!==0)) estimate=0;
        const knownAmount = autoFee + groups.reduce((n,row)=>n+row.recordedAmount,0) + (estimate??0);
        const complete = estimate !== null && groups.every(row=>row.amount!==null);
        const usesEstimate = estimate !== 0 || !groups.length && !sales.some(row=>row.revenueBasis==='net');
        return {category,amount:complete?knownAmount:null,knownAmount,basis:!complete?'incomplete':usesEstimate?rule?.method||'actual':'actual',automaticFee:autoFee,legacy:groups.some(row=>row.legacy),...(rule?{rule}:{})};
    });
    const knownCost = costs.reduce((n,row)=>n+(row.amount??row.knownAmount??0),0);
    const complete = costs.every(row=>row.amount!==null);
    const estimatedCosts = costs.some(row=>row.amount!==null&&row.basis!=='actual'&&row.rule?.value!==0);
    const purchases=active.filter(row=>row.kind==='purchase').reduce((n,row)=>n+sign(row)*row.amount,0);
    if([revenue,knownCost,revenue===null?null:revenue-knownCost,purchases,...costs.map(row=>row.amount)].some(value=>value!==null&&!Number.isSafeInteger(value)))throw new LedgerError('汇总金额超出精确计算范围，请缩短期间或核对异常大额记录');
    return {day,revenue,cost:complete?knownCost:null,knownCost,profit:revenue!==null&&complete?revenue-knownCost:null,costs,complete,
        purchases,estimated:estimatedCosts,
        legacyCosts:costs.some(row=>row.legacy),partialCosts:costs.filter(row=>row.basis==='incomplete').map(row=>row.category)};
}
