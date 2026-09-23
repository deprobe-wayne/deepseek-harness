/** Test-only plugin: scripted model, real Loader, agent loop, tools and SQLite. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmAdapter, createUserMessage } from '../../../packages/llm/llm/lib/index.js';
import { Ledger } from '../src/ledger.mjs';
export const name = 'zhuanleme-profile-fixture';
export const inject = ['agentLoop', 'llm', 'tools', 'workspaceRegistry', 'profileContext'];
class ScriptedModel extends LlmAdapter {
    constructor(steps) { super(); this.steps = steps; this.requests = []; }
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream(options) {
        this.requests.push(options);
        const next = this.steps.shift();
        if (next) {
            const { name, args } = next();
            const block = { type: 'tool-call', id: `call-${this.requests.length}`, name, arguments: JSON.stringify(args) };
            yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments };
            yield { type: 'block-end', index: 0, block };
            yield { type: 'finish', reason: { kind: 'tool-calls' } };
        } else {
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text: '修改建议已保存，等待核对。' };
            yield { type: 'block-end', index: 0, block: { type: 'text', text: '修改建议已保存，等待核对。' } };
            yield { type: 'finish', reason: { kind: 'stop' } };
        }
    }
}
export function apply(ctx) {
    if (!ctx.profileContext.dir.includes('zlm-audit-')) throw new Error('Only an isolated audit Profile may load the fixture');
    console.log('ZLM_AUDIT_MOUNTED');
    let cancelled = false;
    ctx.effect(() => () => { cancelled = true; });
    ctx.effect(() => {
        const timer = setInterval(() => {
            if (!ctx.tools.schemas().some(t => t.name === 'zhuanleme_rules')) return;
            clearInterval(timer);
            if (!cancelled) void run().catch(e => console.log('ZLM_AUDIT_ERROR', e.stack));
        }, 100);
        return () => clearInterval(timer);
    });
    async function run() {
        const folder = join(ctx.profileContext.dir, 'audit-shop');
        await mkdir(folder, { recursive: true });
        const workspace = await ctx.workspaceRegistry.create(folder, '插件规范验收店');
        const ledger = new Ledger(join(ctx.profileContext.dir, 'zhuanleme', 'ledger.sqlite'));
        ctx.effect(() => () => ledger.close());
        const day = '2026-09-22';
        const original = ledger.add(workspace.id, { day, kind: 'purchase', amount: '860', note: '咖啡豆', request: 'seed' });
        const model = new ScriptedModel([
            () => ({ name: 'zhuanleme_report', args: { day } }),
            () => ({ name: 'zhuanleme_draft', args: { day, kind: 'actual', category: 'materials', amount: '300', note: '今日商品成本', request: 'audit-draft' } }),
            () => ({ name: 'zhuanleme_change', args: { id: original, version: 1, action: 'edit', day, kind: 'purchase', amount: '820', note: '咖啡豆修正', request: 'audit-edit' } }),
            () => ({ name: 'zhuanleme_rules', args: { version: 0, rules: [{ category: 'rent', method: 'monthly', value: '3000', effective: day }], request: 'audit-rule' } }),
            () => ({ name: 'zhuanleme_report', args: { day } }),
        ]);
        const live = process.env.ZLM_AUDIT_LIVE === '1';
        if (!live) ctx.llm.registerAdapter(['zlm-audit'], model);
        const agent = await ctx.agentLoop.create(`zlm-audit-${Date.now()}`, live ? { provider: process.env.ZLM_AUDIT_PROVIDER, model: process.env.ZLM_AUDIT_MODEL, ...(process.env.ZLM_AUDIT_EFFORT ? { reasoningEffort: process.env.ZLM_AUDIT_EFFORT } : {}) } : { provider: 'zlm-audit', model: 'audit' }, { cwd: folder });
        await workspace.attachSession(agent.id);
        const idle = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { dispose(); reject(new Error('Agent loop timed out')); }, live ? 180000 : 20000);
            const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
                if (subject.id === agent.id && status === 'idle') { clearTimeout(timer); dispose(); resolve(); }
            });
        });
        agent.followup(createUserMessage({ content: [{ type: 'text', text: '这是隔离验收店，所有操作日期及生效日期均为 2026-09-22。请记录商品成本 300 元；先查询已有账目，再把咖啡豆采购改为 820 元；月租金改为 3000 元。请使用赚了么工具生成一笔待核对草稿与两条修改建议，保留其他成本项目。日期已明确，无需 Bash 或其他工具，也不要确认入账。' }], source: { kind: 'user' } }));
        await idle;
        const events = agent.session.snapshotEvents();
        await writeFile(join(ctx.profileContext.dir, 'audit-session.json'), JSON.stringify(events, null, 2));
        const end = events.filter(e => e.type === 'turn/end').at(-1);
        assert.notEqual(end?.data.reason.kind, 'error', JSON.stringify(end));
        const results = events.filter(e => e.type === 'tool/result');
        if (!live) assert.equal(results.length, 5);
        else assert(results.length >= 3, 'Live model must execute ledger tools');
        const toolErrors = results.filter(e => e.data.message.content[0].isError);
        if (!live) assert.equal(toolErrors.length, 0);
        else {
            // A live model may correct rejected arguments; require a later successful call
            // to the same tool and verify the exact durable effects below.
            const calls = events.filter(e => e.type === 'tool/call');
            for (const error of toolErrors) {
                const failedCall = calls.find(c => c.data.callId === error.data.message.content[0].toolCallId);
                assert(results.some(success => success.seq > error.seq && !success.data.message.content[0].isError && calls.some(c => c.data.callId === success.data.message.content[0].toolCallId && c.data.name === failedCall.data.name)), 'Unrecovered tool error');
            }
        }
        const report = ledger.report(workspace.id, day);
        assert.equal(report.entries.find(e => e.id === original).amount, 86000);
        assert.equal(report.entries.filter(e => e.status === 'draft').length, 1);
        assert.equal(report.proposals.length, 2);
        assert.equal(report.rules.length, 0);
        const draft = report.entries.find(e => e.status === 'draft');
        assert.equal(draft.kind, 'actual');
        assert.equal(draft.category, 'materials');
        assert.equal(draft.amount, 30000);
        assert.equal(draft.day, day);
        const edit = report.proposals.find(p => p.type === 'entry');
        assert.equal(edit.target, original);
        assert.equal(edit.action, 'edit');
        assert.equal(edit.entry.amount, 82000);
        assert.equal(edit.entry.day, day);
        const costRules = report.proposals.find(p => p.type === 'rules').rules;
        assert.deepEqual(costRules, [{ category: 'rent', method: 'monthly', value: 300000, base: null, effective: day }]);
        const reviewResults = results.filter(event => event.data.meta?.review);
        assert.equal(reviewResults.length, 3, 'Each successful business mutation persists its inline confirmation identity');
        for (const event of reviewResults) {
            const result = JSON.parse(event.data.message.content[0].content[0].text);
            assert.deepEqual(event.data.meta, { review: result.review });
            assert.equal(result.review.shop, workspace.id);
            assert.equal(result.review.id, result.id);
            assert.equal(result.review.type, result.id === draft.id ? 'entry' : 'proposal');
        }
        let roundtrip=false;
        if(live){
            ledger.change(workspace.id,{id:draft.id,version:draft.version,action:'confirm'});
            for(const proposal of report.proposals)ledger.resolveProposal(workspace.id,{id:proposal.id,action:'confirm'});
            const intervalStart=agent.session.snapshotEvents().length;
            const nextIdle=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{dispose();reject(new Error('Roundtrip timeout'));},180000);const dispose=ctx.on('agent/status',({agent:subject,status})=>{if(subject.id===agent.id&&status==='idle'){clearTimeout(timer);dispose();resolve();}});});
            agent.followup(createUserMessage({content:[{type:'text',text:'隔离验收的草稿及两条建议已经由测试操作确认。请先查询当前账本，再调用 zhuanleme_period 查询 2026-09-22 至 2026-09-22，说明已确认采购金额和成本、收入是否完整；然后为咖啡豆采购生成删除建议，不要确认删除。只用赚了么工具，不用文件或终端。'}],source:{kind:'user'}}));
            await nextIdle;
            const all=agent.session.snapshotEvents(),later=all.slice(intervalStart);
            await writeFile(join(ctx.profileContext.dir,'audit-session.json'),JSON.stringify(all,null,2));
            assert.notEqual(later.filter(e=>e.type==='turn/end').at(-1)?.data.reason.kind,'error');
            assert.equal(later.filter(e=>e.type==='tool/result'&&e.data.message.content[0].isError).length,0);
            const calls=later.filter(e=>e.type==='tool/call');assert(calls.some(e=>e.data.name==='zhuanleme_report'));assert(calls.some(e=>e.data.name==='zhuanleme_period'));
            const pending=ledger.proposals(workspace.id).filter(p=>p.status==='pending');assert.equal(pending.length,1);assert.equal(pending[0].action,'void');assert.equal(pending[0].target,original);
            assert.equal(ledger.row(workspace.id,original).amount,82000);assert.equal(ledger.row(workspace.id,original).status,'posted');
            ledger.resolveProposal(workspace.id,{id:pending[0].id,action:'confirm'});assert.equal(ledger.period(workspace.id,day,day).totals.purchases,0);
            const deletion=ledger.history(workspace.id).find(h=>h.id===original&&h.action==='void');ledger.mutate(workspace.id,{op:'undo',...deletion.undo});assert.equal(ledger.period(workspace.id,day,day).totals.purchases,82000);
            roundtrip=true;
        }
        console.log('ZLM_AUDIT_OK', JSON.stringify({ shop: workspace.id, day, original, draft: report.entries.find(e => e.status === 'draft').id, proposals: report.proposals.map(p => ({ id: p.id, type: p.type })), session: agent.id, roundtrip, recoveredToolErrors: toolErrors.length, turns: live ? agent.session.snapshotEvents().filter(e => e.type === 'assistant/message').length : model.requests.length, live }));
    }
}
