import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationState } from '../src/conversation-state.mjs';

function registryFixture() {
    const archived = new Set(), shops = { a: { sessionIds: ['one', 'two'] }, b: { sessionIds: ['other'] } };
    return { archived, get: id => shops[id], async archiveSession(id) { archived.add(id); }, async unarchiveSession(id) { archived.delete(id); } };
}

test('deleted conversations persist across reload and restore without changing ledger or transcript files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zlm-conversations-')), registry = registryFixture();
    const path = join(dir, 'conversations.sqlite');
    let state = createConversationState(path, registry);
    try {
        await writeFile(join(dir, 'ledger.sqlite'), 'ledger preserved');
        await writeFile(join(dir, 'session.jsonl'), 'conversation preserved');
        assert.equal(await state.handle({ op: 'add' }), null);
        assert.deepEqual(await state.handle({ op: 'conversation-state' }), { deletedSessionIds: [], pinnedSessionIds: [] });
        assert.deepEqual(await state.handle({ op: 'conversation-delete', shop: 'a', sessionId: 'one' }), { deletedSessionIds: ['one'], pinnedSessionIds: [] });
        assert.equal(registry.archived.has('one'), true);
        assert.deepEqual(await state.handle({ op: 'conversation-delete', shop: 'a', sessionId: 'one' }), { deletedSessionIds: ['one'], pinnedSessionIds: [] });
        await state.close();
        state = createConversationState(path, registry);
        assert.deepEqual(await state.handle({ op: 'conversation-state' }), { deletedSessionIds: ['one'], pinnedSessionIds: [] });
        assert.deepEqual(await state.handle({ op: 'conversation-restore', shop: 'a', sessionId: 'one' }), { deletedSessionIds: [], pinnedSessionIds: [] });
        assert.equal(registry.archived.has('one'), false);
        registry.archived.add('two');
        await state.handle({ op: 'conversation-restore', shop: 'a', sessionId: 'two' });
        assert.equal(registry.archived.has('two'), true, 'restoring a non-deleted conversation must not undo an ordinary archive');
        assert.equal(await readFile(join(dir, 'ledger.sqlite'), 'utf8'), 'ledger preserved');
        assert.equal(await readFile(join(dir, 'session.jsonl'), 'utf8'), 'conversation preserved');
    } finally { await state.close(); await rm(dir, { recursive: true, force: true }); }
});

test('invalid ownership, running conversations, and archive failures do not create deleted markers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zlm-conversations-')), registry = registryFixture();
    let running = true, archiveFails = false;
    const originalArchive = registry.archiveSession;
    registry.archiveSession = async id => { if (archiveFails) throw new Error('archive unavailable'); await originalArchive(id); };
    const state = createConversationState(join(dir, 'conversations.sqlite'), registry, { isRunning: () => running });
    try {
        for (const input of [{ shop: 'a', sessionId: 'other' }, { shop: 'missing', sessionId: 'one' }, { shop: 'a', sessionId: '../one' }, { shop: 'a', sessionId: null }]) {
            await assert.rejects(state.handle({ op: 'conversation-delete', ...input }));
        }
        await assert.rejects(state.handle({ op: 'conversation-delete', shop: 'a', sessionId: 'one' }), /仍在处理中/);
        running = false; archiveFails = true;
        await assert.rejects(state.handle({ op: 'conversation-delete', shop: 'a', sessionId: 'one' }), /archive unavailable/);
        assert.deepEqual(await state.handle({ op: 'conversation-state' }), { deletedSessionIds: [], pinnedSessionIds: [] });
        assert.equal(registry.archived.size, 0);
        archiveFails = false;
        await state.handle({ op: 'conversation-delete', shop: 'a', sessionId: 'one' });
        await assert.rejects(state.handle({ op: 'conversation-restore', shop: 'b', sessionId: 'one' }), /不属于/);
        assert.deepEqual(await state.handle({ op: 'conversation-state' }), { deletedSessionIds: ['one'], pinnedSessionIds: [] });
    } finally { await state.close(); await rm(dir, { recursive: true, force: true }); }
});

test('serialized delete and restore finish before close and failed restores remain recoverable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zlm-conversations-')), registry = registryFixture();
    let failRestore = true;
    registry.unarchiveSession = async id => { if (failRestore) throw new Error('restore unavailable'); registry.archived.delete(id); };
    const state = createConversationState(join(dir, 'conversations.sqlite'), registry);
    try {
        await Promise.all(['one', 'two'].map(sessionId => state.handle({ op: 'conversation-delete', shop: 'a', sessionId })));
        await assert.rejects(state.handle({ op: 'conversation-restore', shop: 'a', sessionId: 'one' }), /restore unavailable/);
        assert.deepEqual(await state.handle({ op: 'conversation-state' }), { deletedSessionIds: ['one', 'two'], pinnedSessionIds: [] });
        failRestore = false;
        const restoring = state.handle({ op: 'conversation-restore', shop: 'a', sessionId: 'one' });
        await state.close();
        assert.deepEqual(await restoring, { deletedSessionIds: ['two'], pinnedSessionIds: [] });
        await assert.rejects(state.handle({ op: 'conversation-state' }), /已关闭/);
    } finally { await state.close(); await rm(dir, { recursive: true, force: true }); }
});

test('pinning is persistent, idempotent and scoped to the session shop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zlm-pins-')), registry = registryFixture(), file = join(dir, 'state.sqlite');
    let state = createConversationState(file, registry);
    try {
        const pin = { op:'conversation-pin', shop:'a', sessionId:'one', pinned:true };
        assert.deepEqual((await state.handle(pin)).pinnedSessionIds, ['one']);
        assert.deepEqual((await state.handle(pin)).pinnedSessionIds, ['one']);
        await assert.rejects(state.handle({ ...pin, shop:'b' }));
        await assert.rejects(state.handle({ ...pin, pinned:'true' }));
        await state.close(); state = createConversationState(file, registry);
        assert.deepEqual((await state.handle({ op:'conversation-state' })).pinnedSessionIds, ['one']);
        assert.deepEqual((await state.handle({ ...pin, pinned:false })).pinnedSessionIds, []);
    } finally { await state.close(); await rm(dir, { recursive:true, force:true }); }
});
