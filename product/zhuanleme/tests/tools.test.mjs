import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { businessDay, registerTools } from '../src/tools.mjs';
import { Ledger } from '../src/ledger.mjs';
test('relative dates use Shanghai across UTC midnight and leap day', () => {
    assert.equal(businessDay('今天', new Date('2026-09-21T17:00:00Z')), '2026-09-22');
    assert.equal(businessDay('yesterday', new Date('2024-02-29T18:00:00Z')), '2024-02-29');
    assert.throws(() => businessDay('2026-02-30'));
});
test('real DSH tool runtime validates input, cancellation and structured canonical results', async () => {
    const ctx = new Context(), ledger = new Ledger(':memory:');
    try {
        await ctx.plugin(SystemPrompt);
        await ctx.plugin(ToolRuntime);
        ctx.provide('workspaceRegistry', { resolveByPath: async p => p === '/shop' ? { id: 'a' } : undefined });
        await ctx.plugin({ name:'ledger-test', inject:['tools','workspaceRegistry'], apply(c) { registerTools(c, ledger, (id, day) => ({ ...ledger.report(id, day), demo: false })); } });
        let seq = 0;
        const execute = (name, args, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, callId: `test-${++seq}`, signal, agent: { session: { header: { cwd: '/shop' } } } });
        const args = { day: 'today', kind: 'purchase', amount: '860', request: 'retry', shop: 'another-shop' };
        const first = await execute('zhuanleme_draft', args);
        assert.equal(first.isError, false);
        assert.equal(first.value.status, 'draft');
        assert.equal(typeof first.value, 'object');
        assert.deepEqual(first.value.review, { shop: 'a', type: 'entry', id: first.value.id });
        assert.equal(ledger.rows('another-shop').length, 0);
        assert.deepEqual(first.meta, { review: first.value.review });
        assert.deepEqual(JSON.parse(first.content[0].text), first.value);
        assert.match(first.value.message, /对话中的确认卡片/);
        ledger.change('a', { id: first.value.id, version: 1, action: 'confirm' });
        const retry = await execute('zhuanleme_draft', args);
        assert.equal(retry.value.status, 'posted');
        assert.deepEqual(retry.value.review, first.value.review);
        assert.equal(ledger.rows('a').length, 1);
        assert.equal((await execute('zhuanleme_draft', { ...args, amount: 860 })).isError, true);
        const abort = AbortSignal.abort(new Error('cancelled'));
        assert.equal((await execute('zhuanleme_draft', { ...args, request: 'cancelled' }, abort)).isError, true);
        assert.equal(ledger.rows('a').length, 1);
        const report = await execute('zhuanleme_report', {});
        assert.equal(report.value.timeZone, 'Asia/Shanghai');
        assert.equal(report.value.entries[0].id, first.value.id);
        const period=await execute('zhuanleme_period',{from:'today',to:'today',limit:1});assert.equal(period.isError,false);assert.equal(period.value.entries[0].id,first.value.id);assert.equal(period.value.totals.purchases,86000);assert.equal(typeof period.value.revision,'number');
        assert.equal((await execute('zhuanleme_rules', { version:0, rules:[{ category:'rent',method:'percent',value:'10',effective:'today' }], request:'no-base' })).isError, true);
        const change = await execute('zhuanleme_change', { id: first.value.id, version: 2, action: 'void', request: 'void-posted' });
        assert.equal(change.isError, false);
        assert.deepEqual(change.value.review, { shop: 'a', type: 'proposal', id: change.value.id });
        assert.deepEqual(change.meta, { review: change.value.review });
        const rulesArgs = { version: 0, rules: [{ category: 'rent', method: 'monthly', value: '3000', effective: 'today' }], request: 'change-rent' };
        const rules = await execute('zhuanleme_rules', rulesArgs);
        assert.equal(rules.isError, false);
        assert.deepEqual(rules.value.review, { shop: 'a', type: 'proposal', id: rules.value.id });
        assert.deepEqual(rules.meta, { review: rules.value.review });
        assert.equal(ledger.rules('a').length, 0);
        ledger.resolveProposal('a', { id: rules.value.id, action: 'confirm' });
        const rulesRetry = await execute('zhuanleme_rules', rulesArgs);
        assert.equal(rulesRetry.value.status, 'applied');
        assert.deepEqual(rulesRetry.meta, rules.meta);
        assert.doesNotMatch(rulesRetry.value.message, /核对并确认后生效/);
    } finally { await ctx.fiber.dispose(); ledger.close(); }
});
test('PTC child dispatches preserve confirmation lookup data in their replayable result content', async () => {
    const ctx = new Context(), ledger = new Ledger(':memory:'), events = [];
    try {
        await ctx.plugin(SystemPrompt);
        // Only program evaluation is scripted; the real ToolRuntime owns nested dispatch and event logging.
        ctx.provide('ptcRuntime', {
            language: 'typescript', isolation: 'test',
            resolve: request => ({ ...request, cwd: request.cwd ?? '/shop', timeoutMs: 10000 }),
            async run(request) {
                const tools = request.bindings[0].functions;
                const draft = await tools.zhuanleme_draft({ day: '2026-09-22', kind: 'purchase', amount: '860', request: 'ptc-draft' });
                const change = await tools.zhuanleme_change({ id: draft.id, version: 1, action: 'void', request: 'ptc-change' });
                const rules = await tools.zhuanleme_rules({ version: 0, rules: [{ category: 'rent', method: 'monthly', value: '3000', effective: '2026-09-22' }], request: 'ptc-rules' });
                return { logs: [], value: [draft, change, rules] };
            },
        });
        await ctx.plugin(ToolRuntime, { mode: 'both' });
        ctx.provide('workspaceRegistry', { resolveByPath: async () => ({ id: 'a' }) });
        await ctx.plugin({ name: 'ledger-ptc-test', inject: ['tools', 'workspaceRegistry'], apply(c) { registerTools(c, ledger, (id, day) => ({ ...ledger.report(id, day), demo: false })); } });
        const result = await ctx.tools.execute({ name: 'run_code', arguments: { code: 'scripted ledger calls', description: 'Generate business confirmations' }, callId: 'ptc-parent', signal: new AbortController().signal,
            agent: { session: { header: { cwd: '/shop' }, append: (type, data) => { events.push({ type, data }); } } } });
        assert.equal(result.isError, false);
        const dispatches = events.filter(event => event.type === 'tool/ptc-dispatch');
        assert.equal(dispatches.length, 3);
        for (const [index, event] of dispatches.entries()) {
            assert.equal(event.data.parentCallId, 'ptc-parent');
            assert.equal(event.data.isError, false);
            const value = JSON.parse(event.data.content[0].text);
            assert.deepEqual(value, result.value.result[index]);
            assert.deepEqual(value.review, { shop: 'a', type: index === 0 ? 'entry' : 'proposal', id: value.id });
        }
        assert.equal(ledger.rows('a')[0].status, 'draft');
        assert.equal(ledger.proposals('a').length, 2);
        assert.equal(ledger.rules('a').length, 0);
    } finally { await ctx.fiber.dispose(); ledger.close(); }
});
