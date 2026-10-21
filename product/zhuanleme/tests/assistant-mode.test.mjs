import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantModes } from '../src/assistant-mode.mjs';
import { createAssistantModeModel } from '../src/client/assistant-mode.js';

test('mode survives restart per conversation and rejects unknown values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zlm-modes-'));
    let modes;
    try {
        modes = createAssistantModes(join(dir, 'modes.sqlite'));
        assert.equal(modes.get('a'), 'record');
        assert.deepEqual(modes.set('a', 'analysis'), { mode: 'analysis' });
        assert.equal(modes.get('b'), 'record');
        assert.throws(() => modes.set('a', 'invalid'), /请选择/);
        modes.close();
        modes = createAssistantModes(join(dir, 'modes.sqlite'));
        assert.equal(modes.get('a'), 'analysis');
        assert.match(modes.prompt('a'), /只查询与分析/);
        assert.match(modes.prompt('b'), /不猜模糊金额/);
    } finally { modes?.close(); await rm(dir, { recursive: true, force: true }); }
});

test('mode UI keeps the accepted choice on failure and serializes repeated clicks', async () => {
    let resolve, fail = true, calls = [];
    const model = createAssistantModeModel({ shop: 'shop-a', sessionId: 'a' }, async input => {
        calls.push(input);
        if (!input.mode) return { mode: 'record' };
        if (fail) throw new Error('Running');
        return new Promise(done => { resolve = done; });
    });
    try {
        await model.load();
        await model.select('analysis');
        assert.equal(model.getSnapshot().mode, 'record');
        assert.equal(model.getSnapshot().error, 'Running');
        fail = false;
        const selection = model.select('analysis');
        await model.select('analysis');
        await model.load();
        assert.equal(calls.length, 3);
        resolve({ mode: 'analysis' }); await selection;
        assert.equal(model.getSnapshot().mode, 'analysis');
        assert.equal(model.getSnapshot().busy, false);
        assert.equal(model.getSnapshot().error, null);
    } finally { model.dispose(); }
});

test('disposed mode requests abort and cannot update a different conversation', async () => {
    let resolve, signal;
    const model = createAssistantModeModel({ shop: 'a', sessionId: 'old' }, (_input, requestSignal) => {
        signal = requestSignal; return new Promise(done => { resolve = done; });
    });
    const load = model.load(), snapshot = model.getSnapshot();
    model.dispose();
    assert.equal(signal.aborted, true);
    resolve({ mode: 'analysis' }); await load;
    assert.equal(model.getSnapshot(), snapshot);
});
