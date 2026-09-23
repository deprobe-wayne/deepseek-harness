import { defineTool } from '@deepseek-ai/dsh-tools';
import { date, categories, channels } from './ledger.mjs';

/** Business dates use the same Shanghai timezone as the ledger UI. */
export function businessDay(value = 'today', now = new Date()) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (['today', '今天'].includes(value)) return today;
    if (['yesterday', '昨天'].includes(value)) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    }
    return date(value);
}
const day = { type: 'string', description: 'YYYY-MM-DD、today/今天、yesterday/昨天；明确的今天无需调用 Bash。查询省略时优先采用当前对话的账表日期，否则上海当天。' };
const request = { type: 'string', required: true, description: '本次业务操作唯一标识；重试保持不变，不可复用于不同内容。' };
const fields = {
    refundOf: {type:'string', description:'退款时必填本店原账目id。金额仍填正数，系统按负向计算，不得超过原金额。非退款不传。'},
    settlement: {type:'string', enum:['unknown','pending','paid'],description:'unknown 未知，pending 待收付，paid 已收付；未知时不能声称已经付款。'},
    account: {type:'string', description:'用户明确给出的收付款账户名称，无需银行卡号。'},
    mode: { type: 'string', enum: ['transaction','summary'], description: 'transaction 为一笔流水并累计；summary 为该日渠道/项目完整汇总。两种口径不能混记。新增默认逐笔。' },
    time: { type: 'string', description: '明确的实际发生时间 HH:mm，上海时区；未知不编造。' },
    day: { ...day, required: true }, kind: { type: 'string', enum: ['revenue', 'purchase', 'actual'], required: true, description:'revenue=营业收入；purchase=采购/进货记录，尚不代表当天耗用；actual=当天实际经营成本，会扣利润。用户说商品成本300元应使用actual + category=materials；只有说采购/进货300元才用purchase。语义不明先询问，不按物品名猜。' },
    amount: { type: 'string', required: true, description: '元的十进制字符串，例如 860.00' },
    category: { type: 'string', enum: categories }, channel: { type: 'string', enum: channels }, note: { type: 'string' },
};
const ruleFields = { category: { type: 'string', enum: categories, required: true }, method: { type: 'string', enum: ['daily', 'monthly', 'percent'], required: true }, value: { type: 'string', required: true, description: 'daily/monthly 单位元；percent 为百分数，例如 30 表示 30%。' }, base: { type: 'string', enum: ['all', ...channels] }, effective: { ...day, required: true } };
const output = properties => ({ schema: { type: 'object', properties, additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] });
const mutationOutput = {
    ...output({
        id: { type: 'string', required: true }, status: { type: 'string', required: true }, message: { type: 'string', required: true },
        review: { type: 'object', required: true, additionalProperties: false, properties: {
            shop: { type: 'string', required: true }, type: { type: 'string', enum: ['entry', 'proposal'], required: true }, id: { type: 'string', required: true },
        } },
    }),
    // Persist only the lookup identity: the authenticated UI reads the latest state before review.
    presentationMeta: (_args, value) => ({ review: value.review }),
};

/** Tools use DSH validation, structured canonical outputs, scoped execution and effect-owned registration. */
export function registerTools(ctx, ledger, report, currentView = () => null, isDeleted = () => false) {
    async function currentShop(exec) {
        exec.signal.throwIfAborted();
        const cwd = exec.agent.session.header.cwd;
        if (!cwd) throw new Error('当前对话没有店铺，请先选择店铺');
        const workspace = await ctx.workspaceRegistry.resolveByPath(cwd);
        if (workspace && isDeleted(workspace.id)) throw new Error('店铺已删除，请先恢复店铺');
        exec.signal.throwIfAborted();
        if (!workspace) throw new Error('当前对话未关联店铺');
        return workspace.id;
    }
    const register = (name, title, description, parameters, result, execute) => ctx.tools.register(defineTool({
        name, description, parameters, output: result, execute,
        presentCall: () => ({ card: 'generic', title }),
        presentResult: (_args, value) => ({ card: 'generic', title, content: value.content }),
    }));
    register('zhuanleme_report', '查询店铺账本', '查询当前店铺经营账、成本依据、账目 id/version、rulesVersion 与待核对修改建议。金额单位整数分。采购不扣利润，缺失不当零。demo=true 为虚拟演示数据。修改前先查询，不猜测 id/version。省略day优先当前账表日期；viewContext包含当前筛选，仅表示视图，报告汇总仍为整日。entries最多100条，截断时用zhuanleme_period分页。利润需同时检查revenueComplete与complete；未日结不能当作完整经营结果。', { day },
        output({ viewContext: {type:'json',required:true}, entriesTotal:{type:'integer',required:true}, entriesTruncated:{type:'boolean',required:true}, history: { type:'array', required:true }, settings: { type:'json', required:true }, summary: { type: 'json', required: true }, trend: { type: 'array', required: true }, entries: { type: 'array', required: true }, rules: { type: 'array', required: true }, rulesVersion: { type: 'integer', required: true }, proposals: { type: 'array', required: true }, demo: { type: 'boolean', required: true }, businessDay: { type: 'string', required: true }, timeZone: { type: 'string', required: true } }),
        async (args, exec) => { const shop = await currentShop(exec); const view=currentView(exec); const resolved=businessDay(args.day|| (view?.shop===shop?view.day:undefined)); const result=report(shop,resolved); return {...result,entries:result.entries.slice(0,100),entriesTotal:result.entries.length,entriesTruncated:result.entries.length>100,viewContext:view?.shop===shop?view:null,businessDay:resolved,timeZone:'Asia/Shanghai'}; });
    register('zhuanleme_period', '查询期间经营报表', '查询当前店铺 1 至 366 天的确定性汇总和分页账目。金额整数分；totals.revenueComplete=false 时收入未全部核对，不能称为完整利润。最多每页500条，用offset继续。status可选posted/draft/void；只改变明细，汇总始终仅含正式入账。', { from: {...day,required:true}, to: {...day,required:true}, offset:{type:'integer'},limit:{type:'integer'},status:{type:'string',enum:['posted','draft','void']} }, output({status:{type:'string',required:true},revision:{type:'integer',required:true},from:{type:'string',required:true},to:{type:'string',required:true},offset:{type:'integer',required:true},limit:{type:'integer',required:true},total:{type:'integer',required:true},hasMore:{type:'boolean',required:true},entries:{type:'array',required:true},days:{type:'array',required:true},totals:{type:'json',required:true}}), async(args,exec)=>ledger.period(await currentShop(exec),businessDay(args.from),businessDay(args.to),args));
    register('zhuanleme_draft', '生成记账草稿', '为当前店铺生成待核对草稿，并在对话中显示确认卡片；用户点击确认后直接入账，无需前往经营总览。工具本身不确认，draft 状态不能称为已入账。revenue 默认为一笔收入（transaction），汇总请明确 mode=summary；purchase 仅用于采购/进货，不扣利润，不可将用户明确说的商品成本记为采购；商品成本使用 actual + category=materials。actual 默认为一笔实际费用，同类逐笔相加并替换该日该类估算。缺日期、金额、必要渠道/成本项目时先问；明确的今天/昨天直接使用相对日期。', { ...fields, request }, mutationOutput,
        async (args, exec) => {
            const shop = await currentShop(exec);
            const id = ledger.add(shop, { ...args, day: businessDay(args.day), source: 'ai', mode: args.mode || 'transaction' }, 'draft');
            const status = ledger.row(shop,id).status;
            return { id, status, review: { shop, type: 'entry', id }, message: status === 'draft' ? '草稿已保存，请在对话中的确认卡片核对并点击确认入账；尚未计入利润。' : '该操作已处理，请以返回状态为准，不重复入账。' };
        });
    register('zhuanleme_change', '建议修改账目', '先查询账目，再为指定 id/version 生成修改或撤销建议，在对话中显示确认卡片；用户点击后直接生效，pending 状态不能称为已修改。edit 提交完整账目字段；void 只需 id/version/action/request。不允许通过此工具确认入账。',
        { ...Object.fromEntries(Object.entries(fields).map(([k, v]) => { const { required, ...optional } = v; return [k, optional]; })), id: { type: 'string', required: true }, version: { type: 'integer', required: true }, action: { type: 'string', enum: ['edit', 'void'], required: true }, request }, mutationOutput,
        async (args, exec) => { const shop = await currentShop(exec); if (args.action === 'edit' && !args.day) throw new Error('修改账目需要完整日期'); const result = ledger.propose(shop, { ...args, type: 'entry', ...(args.action === 'edit' ? { day: businessDay(args.day) } : {}) }); return { ...result, review: { shop, type: 'proposal', id: result.id }, message: result.status === 'pending' ? '修改建议已保存，请在对话中的确认卡片核对并确认后生效。' : '该修改建议已处理，请以返回状态为准，不重复修改。' }; });
    register('zhuanleme_rules', '建议修改成本规则', '为用户明确指定的成本项目生成规则修改建议，在对话中显示确认卡片，用户点击后直接生效。先查询取得 rulesVersion，作为 version 传入。可只改一个项目；未指定项目保持不变，不能补零。percent 必须明确 base，所有规则必须有生效日期。pending 状态不能称为已修改。',
        { version: { type: 'integer', required: true }, rules: { type: 'array', required: true, items: { type: 'object', properties: ruleFields, additionalProperties: false } }, request }, mutationOutput,
        async (args, exec) => { const shop = await currentShop(exec); const result = ledger.propose(shop, { ...args, type: 'rules', rules: args.rules.map(r => ({ ...r, effective: businessDay(r.effective) })) }); return { ...result, review: { shop, type: 'proposal', id: result.id }, message: result.status === 'pending' ? '成本规则建议已保存，请在对话中的确认卡片核对并确认后生效。' : '该成本规则建议已处理，请以返回状态为准，不重复修改。' }; });
}
