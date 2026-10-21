import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installConversationTitles } from '../src/conversation-titles.mjs';

test('human titles need no model and repair only generated ACP errors in shop conversations', async () => {
    const repaired = [], listeners = new Map(), effects = [];
    let provider;
    const session = (id, source, title) => ({ id, header: { cwd: '/shop' }, current: { source: { kind: source }, title } });
    const bad = session('bad', 'provider', '❌ [ACP] stream error: the turn degenerated again after the continuation nudge');
    const pinned = session('pinned', 'user', bad.current.title), ordinary = session('ordinary', 'provider', '白菜采购');
    const foreign = session('foreign', 'provider', bad.current.title);
    const ctx = {
        effect(fn) { effects.push(fn()); }, on(name, fn) { listeners.set(name, fn); }, logger: { warn() { assert.fail('unexpected repair failure'); } },
        agents: { list: () => [bad, pinned, ordinary, foreign].map(session => ({ session })) },
        workspaceRegistry: { resolveByPath: async () => ({ sessionIds: ['bad', 'pinned', 'ordinary'] }) },
        sessionTitle: { get: session => session.current, async refresh(session) { repaired.push(session.id); }, register(value) { provider = value; return () => { provider = undefined; }; } },
    };
    await installConversationTitles(ctx);
    assert.deepEqual(repaired, ['bad']);
    const request = { messages: [{ seq: 9, text: '买了4斤白菜，每斤5元' }], signal: new AbortController().signal };
    assert.deepEqual(await provider.generate(request), { title: '买了4斤白菜，每斤5元', messageSeqs: [9] });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => provider.generate({ ...request, signal: controller.signal }));
    await listeners.get('agent/created')({ agent: { session: bad } });
    assert.deepEqual(repaired, ['bad', 'bad']);
    effects.forEach(dispose => dispose()); assert.equal(provider, undefined);
});
