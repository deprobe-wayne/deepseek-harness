import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/host.mjs';
test('host binds AI drafts to the calling session and disposes routes and tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zlm-host-')), effects = [], routes = new Map(), tools = new Map();
    const archived = new Set();
    let fetchHandler;
    const ctx = { profileContext: { dir }, effect: fn => { const dispose = fn(); if (dispose)
            effects.push(dispose); }, agents: { get: id => id === 'running' ? { status: 'running' } : undefined }, connection: { fetch: { register: r => { fetchHandler = r.fetch; effects.push(() => { fetchHandler = undefined; }); } } }, webServer: { register: r => { routes.set(r.path, r); return () => routes.delete(r.path); } }, workspaceRegistry: { get: id => ['a', 'b'].includes(id) ? { id, title: `店铺 ${id}`, sessionIds: id === 'a' ? ['running', 'idle'] : [] } : undefined, resolveByPath: async (path) => path === '/shop-a' ? { id: 'a' } : undefined, archiveSession: async id => { archived.add(id); }, unarchiveSession: async id => { archived.delete(id); } }, tools: { register: t => { tools.set(t.name, t); effects.push(() => tools.delete(t.name)); } } };
    try {
        await apply(ctx);
        const post = input => fetchHandler(new Request('http://localhost/api/zhuanleme', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(input) }));
        assert.equal((await post({ op: 'conversation-delete', shop: 'a', sessionId: 'running' })).status, 400);
        assert.equal(archived.has('running'), false);
        assert.equal((await post({ op: 'conversation-delete', shop: 'a', sessionId: 'idle' })).status, 200);
        assert.equal(archived.has('idle'), true);
        assert.deepEqual(await (await post({ op: 'conversation-state' })).json(), { deletedSessionIds: ['idle'], pinnedSessionIds: [] });
        assert.equal((await post({ op: 'conversation-restore', shop: 'a', sessionId: 'idle' })).status, 200);
        assert.equal(archived.has('idle'), false);
        const exec = { signal: new AbortController().signal, agent: { id:'idle', session: { header: { cwd: '/shop-a' } } } };
        assert.equal((await post({op:'view-context',shop:'a',sessionId:'idle',day:'2026-08-01',section:'expenses',search:'咖啡'})).status,200);
        assert.equal((await post({op:'view-context',shop:'b',sessionId:'idle',day:'2026-08-02'})).status,400);
        const viewed=await tools.get('zhuanleme_report').execute({},exec);
        assert.equal(viewed.businessDay,'2026-08-01');assert.equal(viewed.viewContext.search,'咖啡');
        const explicit=await tools.get('zhuanleme_report').execute({day:'2026-09-21'},exec);assert.equal(explicit.businessDay,'2026-09-21');
        const result = (await tools.get('zhuanleme_draft').execute({ day: '2026-09-21', kind: 'purchase', amount: '860', request: 'model-call-1' }, exec));
        assert.equal(result.status, 'draft');
        assert.deepEqual(result.review, { shop: 'a', type: 'entry', id: result.id });
        const reviewInput = { op: 'review', ...result.review };
        const reviewResponse = await post(reviewInput);
        assert.equal(reviewResponse.headers.get('cache-control'), 'no-store');
        const review = await reviewResponse.json();
        assert.deepEqual(review.shop, { id: 'a', title: '店铺 a' });
        assert.equal(review.type, 'entry');
        assert.equal(review.item.id, result.id);
        assert.equal(review.item.status, 'draft');
        assert.equal(review.item.version, 1);
        assert.equal(review.item.amount, 86000);
        assert.equal(review.demo, false);
        for (const input of [{ ...reviewInput, shop: 'b' }, { ...reviewInput, shop: 'missing' }, { ...reviewInput, type: 'unknown' }, { ...reviewInput, id: '' }, { ...reviewInput, id: result.id + '-missing' }]) {
            assert.equal((await post(input)).status, 400);
        }
        const report = (await tools.get('zhuanleme_report').execute({ day: '2026-09-21' }, exec));
        assert.equal(report.entries[0].status, 'draft');
        assert.equal(report.summary.purchases, 0);
        await assert.rejects(() => tools.get('zhuanleme_report').execute({ day: '2026-09-21' }, { signal: exec.signal, agent: { session: { header: { cwd: '/unknown' } } } }));
        const get = await fetchHandler(new Request('http://localhost/api/zhuanleme?shop=b&day=2026-09-21'));
        assert.equal((await get.json()).entries.length, 0);
        const badOrigin = await fetchHandler(new Request('http://localhost/api/zhuanleme', { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'http://other' }, body: '{}' }));
        assert.equal(badOrigin.status, 415);
        assert.equal((await post({ op: 'change', shop: 'a', id: result.id, version: review.item.version, action: 'confirm' })).status, 200);
        assert.equal((await (await post(reviewInput)).json()).item.status, 'posted');
        const saved = (await tools.get('zhuanleme_report').execute({ day: '2026-09-21' }, exec));
        assert.equal(saved.summary.purchases, 86000);
        const suggestion = await tools.get('zhuanleme_change').execute({ id: result.id, version: 2, action: 'void', request: 'void-1' }, exec);
        const suggestionReview = { op: 'review', ...suggestion.review };
        const pending = await (await post(suggestionReview)).json();
        assert.equal(pending.type, 'proposal');
        assert.equal(pending.item.id, suggestion.id);
        assert.equal(pending.item.target, result.id);
        assert.equal(pending.item.status, 'pending');
        assert.equal(pending.item.before.amount, 86000);
        assert.equal((await post({ ...suggestionReview, shop: 'b' })).status, 400);
        assert.equal((await post({ op: 'proposal', shop: 'a', id: suggestion.id, action: 'confirm' })).status, 200);
        assert.equal((await (await post(suggestionReview)).json()).item.status, 'applied');
        assert.equal((await (await post(reviewInput)).json()).item.status, 'void');
        const manual = await (await post({ op: 'add', shop: 'a', day: '2026-09-21', kind: 'purchase', amount: '25', note: '表格录入', request: 'undo-interop' })).json();
        assert.equal((await tools.get('zhuanleme_report').execute({ day: '2026-09-21' }, exec)).summary.purchases, 2500);
        assert.equal((await post({ op: 'undo', shop: 'a', ...manual.undo })).status, 200);
        assert.equal((await tools.get('zhuanleme_report').execute({ day: '2026-09-21' }, exec)).summary.purchases, 0);
        const rules = ['materials', 'labor', 'rent', 'utilities', 'platform', 'other'].map(category => ({ category, method: 'daily', value: '0', effective: '2026-09-21' }));
        assert.equal((await post({ op: 'rules', shop: 'a', rules })).status, 400);
        assert.equal((await post({ op: 'rules', shop: 'a', rules, version: 0 })).status, 200);
        assert.equal((await post({ op: 'rules', shop: 'a', rules, version: 0 })).status, 400);
        assert.equal((await post({op:'shop-delete',shop:'a'})).status,400);
        assert.equal((await post({op:'shop-delete',shop:'b'})).status,200);
        assert.equal((await post({op:'period',shop:'b',from:'2026-09-21',to:'2026-09-21'})).status,400);
        assert.deepEqual((await (await post({op:'shop-state'})).json()).deleted,['b']);
        assert.equal((await post({op:'shop-restore',shop:'b'})).status,200);
        assert.equal((await post({op:'period',shop:'b',from:'2026-09-21',to:'2026-09-21'})).status,200);
    }
    finally {
        for (const dispose of effects.reverse())
            await dispose();
        rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(routes.size, 0);
    assert.equal(tools.size, 0);
    assert.equal(fetchHandler, undefined);
});
