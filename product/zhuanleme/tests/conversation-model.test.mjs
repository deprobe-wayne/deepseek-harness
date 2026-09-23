import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationActions, groupConversations } from '../src/client/conversation-model.js';
import { conversationZh, conversationEn } from '../src/client/conversation-locales.js';

test('all shop history remains reachable while archives, deleted rows, and child agents stay separate', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const sessions = Object.fromEntries(ids.map(id => [id, { title: id }]));
    sessions.child = { origin: 'subagent', title: 'child agent' };
    sessions.foreign = { title: 'another shop' };
    const grouped = groupConversations({ sessionIds: [...ids, 's0', 'missing', 'child'] }, sessions, ['s7','s8'], ['s8']);
    assert.deepEqual(grouped.active.map(row => row.id), ['s0','s1','s2','s3','s4','s5','s6','s9']);
    assert.deepEqual(grouped.archived.map(row => row.id), ['s7']);
    assert.deepEqual(grouped.deleted.map(row => row.id), ['s8']);
    assert.deepEqual(Object.keys(conversationZh).sort(), Object.keys(conversationEn).sort());
});

test('official archive callbacks and recoverable deletion carry the exact conversation and shop', async () => {
    const calls = [];
    let deletedSessionIds = [];
    const actions = createConversationActions({
        api: async input => { calls.push(input); if (input.op === 'conversation-delete') deletedSessionIds = [input.sessionId]; if (input.op === 'conversation-restore') deletedSessionIds = []; return { deletedSessionIds }; },
        navigation: { archiveSession: async id => calls.push(['archive', id]), unarchiveSession: async id => calls.push(['unarchive', id]) },
    });
    await actions.load();
    await actions.archiveSession('one'); await actions.unarchiveSession('one');
    await actions.deleteSession('one', 'shop');
    assert.deepEqual(actions.getSnapshot().deletedSessionIds, ['one']);
    await actions.restoreSession('one', 'shop');
    assert.deepEqual(actions.getSnapshot().deletedSessionIds, []);
    assert.deepEqual(calls, [{ op: 'conversation-state' }, ['archive','one'], ['unarchive','one'], { op: 'conversation-delete', sessionId: 'one', shop: 'shop' }, ['archive','one'], { op: 'conversation-state' }, { op: 'conversation-restore', sessionId: 'one', shop: 'shop' }, { op: 'conversation-state' }]);
    actions.dispose();
});

test('stale refreshes cannot resurrect deleted state and duplicate row actions share one request', async () => {
    const reads = [], writes = [];
    const actions = createConversationActions({ api: input => input.op === 'conversation-state' ? new Promise(resolve => reads.push(resolve)) : new Promise(resolve => writes.push(resolve)), navigation: { archiveSession: async () => {} } });
    const stale = actions.load(), current = actions.load();
    reads[1]({ deletedSessionIds: ['two'] }); await current;
    reads[0]({ deletedSessionIds: [] }); await stale;
    assert.deepEqual(actions.getSnapshot().deletedSessionIds, ['two']);
    const first = actions.deleteSession('one', 'shop'), second = actions.deleteSession('one', 'shop');
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(writes.length, 1);
    writes[0]({ deletedSessionIds: ['one','two'] });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    reads[2]({ deletedSessionIds: ['one','two'] });
    await first;
    assert.deepEqual(actions.getSnapshot().deletedSessionIds, ['one','two']);
    actions.dispose();
});

test('failed reads remain visible for retry and disposal suppresses late notifications', async () => {
    let resolveRead, failing = true, notifications = 0;
    const actions = createConversationActions({ api: () => failing ? Promise.reject(new Error('offline')) : new Promise(resolve => { resolveRead = resolve; }), navigation: {} });
    actions.subscribe(() => notifications++);
    await actions.load();
    assert.equal(actions.getSnapshot().error, 'offline');
    failing = false;
    const pending = actions.load();
    actions.dispose(); resolveRead({ deletedSessionIds: ['late'] }); await pending;
    assert.equal(notifications, 1);
    assert.deepEqual(actions.getSnapshot().deletedSessionIds, []);
});

test('pinned conversations lead the active list without changing archive and deletion membership', () => {
    const sessions = { a:{title:'A'}, b:{title:'B'}, c:{title:'C'} };
    assert.deepEqual(groupConversations({sessionIds:['a','b','c']}, sessions, [], [], ['c','a']).active.map(r=>r.id), ['c','a','b']);
    assert.deepEqual(groupConversations({sessionIds:['a','b','c']}, sessions, ['c'], [], ['c']).active.map(r=>r.id), ['a','b']);
});
