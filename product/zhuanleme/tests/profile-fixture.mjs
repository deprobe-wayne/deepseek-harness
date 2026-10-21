/** Test-only plugin: scripted model, real Loader, agent loop, tools and SQLite. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmAdapter, createUserMessage, ReasoningEffortId } from '../../../packages/llm/llm/lib/index.js';
import { Ledger } from '../src/ledger.mjs';
import { createAssistantModes } from '../src/assistant-mode.mjs';
import { groupTurnReviews } from '../src/client/review-model.js';
import { verifyReliabilityProfile } from './reliability-profile.mjs';
import { verifyProfitProfile } from './profit-profile.mjs';
export const name = 'zhuanleme-profile-fixture';
export const inject = ['agentLoop', 'agentPresets', 'systemPrompt', 'llm', 'tools', 'workspaceRegistry', 'profileContext', 'settings', 'attachments', 'sessionController', 'sessionPersistence'];
class ScriptedModel extends LlmAdapter {
    constructor(steps) { super(); this.steps = steps; this.requests = []; }
    async resolveModel(provider, id) { return { provider, id, name: id, inputModalities: this.vision ? ['text', 'image'] : ['text'], ...(this.vision ? { reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }, { id: ReasoningEffortId('low'), name: 'On' }], defaultEffort: ReasoningEffortId('off') } } : {}) }; }
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
            const text = this.answer || '请核对后确认入账。';
            yield { type: 'text-delta', index: 0, text };
            yield { type: 'block-end', index: 0, block: { type: 'text', text } };
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
            if (!['zhuanleme_rules', 'voice_health', 'voice_stt', 'voice_stream'].every(name => ctx.tools.schemas().some(t => t.name === name))) return;
            clearInterval(timer);
            if (!cancelled) void run().catch(e => console.log('ZLM_AUDIT_ERROR', e.stack));
        }, 100);
        return () => clearInterval(timer);
    });
    async function run() {
        const voiceSettings = () => ctx.settings.describe().find(row => row.ns === 'dsh-voice')?.value;
        assert.equal(voiceSettings()?.sensevoiceAutostart, false);
        await ctx.settings.update('dsh-voice', { beep: false });
        assert.equal(voiceSettings()?.beep, false);
        await ctx.settings.update('dsh-voice', { beep: true });
        assert.equal(voiceSettings()?.beep, true);
        assert.equal(ctx.agentPresets.defaultId, 'zhuanleme');
        assert.deepEqual(await ctx.agentPresets.resolve(), { id: 'zhuanleme' });
        const preset = await ctx.agentPresets.acquireScope();
        try {
            const assembly = await ctx.systemPrompt.assemble({ scope: preset.key });
            assert.equal(assembly.sections.length, 1);
            assert.match(assembly.sections[0].text, /你是「赚了么」的店铺经营助手/);
            assert(assembly.tools.some(tool => tool.name === 'ask_user_question'));
            assert(assembly.tools.some(tool => tool.name === 'zhuanleme_draft'));
            assert(!assembly.tools.some(tool => ['bash', 'present'].includes(tool.name)));
        } finally { await preset[Symbol.asyncDispose](); }
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
        const recognition = { document_type: 'receipt', date: day, merchant: null, currency: 'CNY', items: [{ name: '商品成本', quantity: null, unit: null, unit_price: null, amount: '300' }], total: '300', uncertain_fields: [] };
        const vision = new ScriptedModel([]);
        vision.vision = true;
        vision.answer = JSON.stringify(recognition);
        if (!live) {
            ctx.llm.registerAdapter(['zlm-audit'], model);
            ctx.llm.registerAdapter(['qwen-vision'], vision);
            await ctx.settings.update('agent-default-model', { provider: 'zlm-audit', model: 'audit' });
        }
        const handle = await ctx.agentLoop.createAgent(ctx, { sessionId: `zlm-audit-${Date.now()}`, agentOptions: live ? { provider: process.env.ZLM_AUDIT_PROVIDER, model: process.env.ZLM_AUDIT_MODEL, ...(process.env.ZLM_AUDIT_EFFORT ? { reasoningEffort: process.env.ZLM_AUDIT_EFFORT } : {}) } : { provider: 'zlm-audit', model: 'audit' }, meta: { cwd: folder }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'zhuanleme'); } });
        const agent = handle.agent;
        await workspace.attachSession(agent.id);
        const idle = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { dispose(); reject(new Error('Agent loop timed out')); }, live ? 180000 : 20000);
            const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
                if (subject.id === agent.id && status === 'idle') { clearTimeout(timer); dispose(); resolve(); }
            });
        });
        // Use the same image-admission endpoint as the browser, with a text-only main model.
        const image = !live && { type: 'image', data: (await readFile(new URL('../assets/logo.png', import.meta.url))).toString('base64'), mediaType: 'image/png', name: '验收图片.png' };
        const content = [{ type: 'text', text: '这是隔离验收店，所有操作日期及生效日期均为 2026-09-22。请记录商品成本 300 元；先查询已有账目，再把咖啡豆采购改为 820 元；月租金改为 3000 元。请使用赚了么工具生成一笔待核对草稿与两条修改建议，保留其他成本项目。日期已明确，无需 Bash 或其他工具，也不要确认入账。' }, ...(image ? [image] : [])];
        if (live) agent.followup(createUserMessage({ content, source: { kind: 'user' } }));
        else assert.deepEqual(await ctx.sessionController.prompt({ sessionId: agent.id, mode: 'queue', requestId: 'zlm-image-admission', content }, new AbortController().signal), { accepted: true });
        await idle;
        const events = agent.session.snapshotEvents();
        await writeFile(join(ctx.profileContext.dir, 'audit-session.json'), JSON.stringify(events, null, 2));
        const systemText = events.filter(e => e.type === 'system/message').flatMap(e => e.data.message.content).map(c => c.text || '').join('\n');
        assert.equal(events.filter(e => e.type === 'session/title-llm-request').length, 0, 'Titles never invoke the upstream ACP model route');
        assert.match(events.filter(e => e.type === 'session/title').at(-1)?.data.title || '', /隔离验收店/);
        assert.match(systemText, /你是「赚了么」的店铺经营助手/);
        assert.doesNotMatch(systemText, /coding agent|software engineer/);
        const end = events.filter(e => e.type === 'turn/end').at(-1);
        assert.notEqual(end?.data.reason.kind, 'error', JSON.stringify(end));
        const results = events.filter(e => e.type === 'tool/result');
        if (!live) {
            assert.equal(results.length, 5);
            assert.equal(vision.requests.length, 1, 'Qwen runs once for the uploaded image');
            assert(vision.requests[0].messages.some(message => message.content.some(block => block.type === 'image' && !block.offloaded)), 'Original native attachment reaches the vision branch');
            assert(model.requests.every(request => request.provider === 'zlm-audit'), 'The main conversation never changes provider');
            assert(model.requests[0].messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes(JSON.stringify(recognition)))), 'Structured vision facts reach the main model');
            assert(model.requests.every(request => !request.messages.some(message => message.content.some(block => block.type === 'image' && !block.offloaded))), 'Main model does not receive image bytes');
        }
        else assert(results.length >= 3, 'Live model must execute ledger tools');
        const toolErrors = results.filter(e => e.data.message.isError);
        if (!live) assert.equal(toolErrors.length, 0);
        else {
            // A live model may correct rejected arguments; require a later successful call
            // to the same tool and verify the exact durable effects below.
            const calls = events.filter(e => e.type === 'tool/call');
            for (const error of toolErrors) {
                const failedCall = calls.find(c => c.data.callId === error.data.message.toolCallId);
                assert(results.some(success => success.seq > error.seq && !success.data.message.isError && calls.some(c => c.data.callId === success.data.message.toolCallId && c.data.name === failedCall.data.name)), 'Unrecovered tool error');
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
            const result = JSON.parse(event.data.message.content[0].text);
            assert.deepEqual(event.data.meta, { review: result.review });
            assert.equal(result.review.shop, workspace.id);
            assert.equal(result.review.id, result.id);
            assert.equal(result.review.type, result.id === draft.id ? 'entry' : 'proposal');
        }
        if (!live) {
            const modes = createAssistantModes(join(ctx.profileContext.dir, 'zhuanleme/assistant.sqlite'));
            modes.set(agent.id, 'analysis'); modes.close();
            model.steps.push(() => ({ name: 'zhuanleme_report', args: { day } }));
            model.answer = '咖啡豆采购已记录 860 元，实际商品成本仍待确认；收入尚未核对，暂不能判断完整利润。';
            const finished = new Promise((resolve, reject) => {
                const timer = setTimeout(() => { stop(); reject(new Error('Analysis turn timed out')); }, 20000);
                const stop = ctx.on('agent/status', ({ agent: subject, status }) => {
                    if (subject.id === agent.id && status === 'idle') { clearTimeout(timer); stop(); resolve(); }
                });
            });
            agent.followup(createUserMessage({ content: [{ type: 'text', text: '看看当天经营情况。' }], source: { kind: 'user' } }));
            await finished;
            assert.equal(vision.requests.length, 1, 'Text with an image in history does not rerun recognition');
            assert.equal(ledger.rows(workspace.id).length, 2, 'Analysis does not add ledger entries');
            const itemModes = createAssistantModes(join(ctx.profileContext.dir, 'zhuanleme/assistant.sqlite'));
            itemModes.set(agent.id, 'record'); itemModes.close();
            const itemRecognition = { document_type: 'receipt', date: day, merchant: null, currency: 'CNY',
                items: [{ name:'白菜', quantity:'4', unit:'斤', unit_price:'5', amount:'20' },
                    { name:'虾', quantity:'2', unit:'斤', unit_price:'30', amount:'60' },
                    { name:'白菜', quantity:'3', unit:'斤', unit_price:'6', amount:'18' }], total:'98', uncertain_fields:[] };
            vision.answer = JSON.stringify(itemRecognition);
            model.answer = '请核对后确认入账。';
            for (const [index, item] of itemRecognition.items.entries()) model.steps.push(() => ({ name:'zhuanleme_draft',
                args:{ day, kind:'purchase', note:item.name, amount:item.amount,
                    details:`${item.quantity}${item.unit}×${item.unit_price}元/${item.unit}`, request:`audit-receipt-item-${index}` } }));
            const receiptDone = new Promise((resolve, reject) => {
                const timer = setTimeout(() => { stop(); reject(new Error('Itemized receipt turn timed out')); }, 20000);
                const stop = ctx.on('agent/status', ({ agent:subject, status }) => {
                    if (subject.id === agent.id && status === 'idle') { clearTimeout(timer); stop(); resolve(); }
                });
            });
            await ctx.sessionController.prompt({ sessionId:agent.id, mode:'queue', requestId:'audit-itemized-receipt',
                content:[{ type:'text', text:'请按这张2026-09-22小票中的每项商品分别记录采购。' }, image] }, new AbortController().signal);
            await receiptDone;
            const items = ledger.rows(workspace.id).filter(row => row.kind === 'purchase' && row.status === 'draft').reverse();
            assert.deepEqual(items.map(row => ({ note:row.note, amount:row.amount, details:row.details })), [
                { note:'白菜', amount:2000, details:'4斤×5元/斤' },
                { note:'虾', amount:6000, details:'2斤×30元/斤' },
                { note:'白菜', amount:1800, details:'3斤×6元/斤' },
            ]);
            assert(!items.some(row => row.amount === 9800), 'Receipt total is never an additional entry');
            assert.equal(vision.requests.length, 2);
            const recorded = agent.session.snapshotEvents();
            const prompts = recorded.filter(e => e.type === 'system/message').map(e => e.data.message.content.map(c => c.text || '').join('\n'));
            assert(prompts.some(text => text.includes('当前为录入模式')));
            assert(prompts.some(text => text.includes('当前为分析模式')));
            const output = recorded.filter(e => e.type === 'assistant/message').flatMap(e => e.data.message.content).filter(c => c.type === 'text').map(c => c.text);
            const routes = recorded.filter(e => e.type === 'request/header').map(e => ({ provider: e.data.header.config.provider, model: e.data.header.config.model }));
            assert(routes.every(route => route.provider === 'zlm-audit' && route.model === 'audit'));
            const imageEvents = recorded.filter(e => ['zhuanleme/image-request', 'zhuanleme/image-result'].includes(e.type)).map(e => ({ type: e.type, ...(e.data.config ? { route: { provider: e.data.config.provider, model: e.data.config.model }, system: e.data.system } : { status: e.data.status, result: e.data.result }) }));
            const admission = { via: 'session.prompt', mainInput: (await model.resolveModel('zlm-audit', 'audit')).inputModalities,
                recognizedImages: vision.requests.length, mainProvider: model.requests[0].provider };
            const itemizedReceipt = items.map(row => ({ note:row.note, amount:row.amount, details:row.details, status:row.status }));
            const recognitionNotices = recorded.filter(event => event.type === 'user/message' && event.data.source?.kind === 'zhuanleme-image-recognition')
                .map(event => event.data.content.map(block => block.text || '').join('\n'));
            assert.equal(recognitionNotices.length, 2, 'Structured recognition notices persist in the session');
            await ctx.sessionPersistence.flush();
            const reader = await ctx.sessionPersistence.open(agent.id, 'read');
            let historyReload;
            try {
                const { events: restored } = await reader.read();
                historyReload = restored.filter(event => event.type.startsWith('zhuanleme/image-')).map(event => ({ type:event.type, ignorable:event.ignorable }));
                assert.equal(historyReload.length, 4);
                assert(historyReload.every(event => event.ignorable === true), 'Persisted image history reopens without unknown required events');
            } finally { await reader.close(); }
            const groups = groupTurnReviews(items.map(item => ({ shop:workspace.id, type:'entry', id:item.id })));
            assert.equal(groups.length, 1, 'One receipt has one confirmation group');
            const receiptReview = { type:groups[0].type, items:groups[0].ids.length };
            const transcript = { prompts: [...new Set(prompts)], replies: output, routes, imageEvents, admission, itemizedReceipt, recognitionNotices, historyReload, receiptReview };
            const expected = new URL('./expected/assistant-mode-transcript.json', import.meta.url);
            if (process.env.ZLM_RECORD_EXPECTED === '1') {
                await mkdir(new URL('./expected/', import.meta.url), { recursive: true });
                await writeFile(expected, JSON.stringify(transcript, null, 2) + '\n');
            } else assert.deepEqual(transcript, JSON.parse(await readFile(expected, 'utf8')));
            await writeFile(join(ctx.profileContext.dir, 'audit-session.json'), JSON.stringify(recorded, null, 2));
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
            assert.equal(later.filter(e=>e.type==='tool/result'&&e.data.message.isError).length,0);
            const calls=later.filter(e=>e.type==='tool/call');assert(calls.some(e=>e.data.name==='zhuanleme_report'));assert(calls.some(e=>e.data.name==='zhuanleme_period'));
            const pending=ledger.proposals(workspace.id).filter(p=>p.status==='pending');assert.equal(pending.length,1);assert.equal(pending[0].action,'void');assert.equal(pending[0].target,original);
            assert.equal(ledger.row(workspace.id,original).amount,82000);assert.equal(ledger.row(workspace.id,original).status,'posted');
            ledger.resolveProposal(workspace.id,{id:pending[0].id,action:'confirm'});assert.equal(ledger.period(workspace.id,day,day).totals.purchases,0);
            const deletion=ledger.history(workspace.id).find(h=>h.id===original&&h.action==='void');ledger.mutate(workspace.id,{op:'undo',...deletion.undo});assert.equal(ledger.period(workspace.id,day,day).totals.purchases,82000);
            roundtrip=true;
        }
        if (!live) await verifyReliabilityProfile(ctx, ScriptedModel);
        if (!live) await verifyProfitProfile(ctx, ScriptedModel);
        console.log('ZLM_AUDIT_OK', JSON.stringify({ shop: workspace.id, day, original, draft: report.entries.find(e => e.status === 'draft').id, proposals: report.proposals.map(p => ({ id: p.id, type: p.type })), session: agent.id, roundtrip, recoveredToolErrors: toolErrors.length, turns: live ? agent.session.snapshotEvents().filter(e => e.type === 'assistant/message').length : model.requests.length, live }));
    }
}
