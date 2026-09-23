import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewModel, reviewReference, turnReviewReferences, validReview } from '../src/client/review-model.js';
import { shopForSession } from '../src/client/model.js';

const entryRef = { shop: 'shop-a', type: 'entry', id: 'entry-a' };
const proposalRef = { shop: 'shop-a', type: 'proposal', id: 'proposal-a' };
const entry = overrides => ({ id: 'entry-a', day: '2026-09-22', kind: 'purchase', amount: 86000, category: null, channel: null, note: '咖啡豆', source: 'ai', status: 'draft', version: 7, ...overrides });
const response = (type, item) => ({ shop: { id: 'shop-a', title: '测试店铺' }, demo: false, type, item });
const entryResponse = overrides => response('entry', entry(overrides));
const proposalResponse = overrides => response('proposal', { id: 'proposal-a', status: 'pending', type: 'entry', target: 'entry-a', version: 7, action: 'edit', before: entry({ status: 'posted' }), entry: entry({ amount: 82000 }), ...overrides });
const rule = { category: 'rent', method: 'monthly', value: 300000, base: null, effective: '2026-09-22' };
const resultBlock = value => ({ kind: 'tool-result', isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const callResult = (name, ref) => ({ ...resultBlock({ id: ref.id, review: ref }), call: { name } });
const toolNode = root => ({ kind: 'tool-call', data: { root } });
const turnSnapshot = turns => ({ locations: { getTurn: turn => (turns[turn] || []).map((_, index) => `${turn}/${index}`) }, nodes: new Map(Object.entries(turns).flatMap(([turn, nodes]) => nodes.map((node, index) => [`${turn}/${index}`, node]))) });

test('session membership resolves a shop when the stored path and cwd use different aliases', () => {
    const shop = { workspaceId: 'shop-a', path: '/var/folders/test/shop-a', sessionIds: ['session-a'] };
    assert.equal(shopForSession([shop], 'session-a', '/private/var/folders/test/shop-a'), shop);
    assert.equal(shopForSession([shop], 'session-a', undefined), shop);
    assert.equal(reviewReference('zhuanleme_draft', resultBlock({ id: 'entry-a', review: entryRef }), shopForSession([shop], 'session-a', '/private/var/folders/test/shop-a').workspaceId)?.shop, 'shop-a');
});

test('session membership takes priority over another shop with a matching cwd', () => {
    const matchingPath = { workspaceId: 'shop-b', path: '/shops/shared', sessionIds: ['session-b'] };
    const sessionOwner = { workspaceId: 'shop-a', path: '/shops/original', sessionIds: ['session-a'] };
    assert.equal(shopForSession([matchingPath, sessionOwner], 'session-a', '/shops/shared'), sessionOwner);
    assert.equal(shopForSession([sessionOwner, matchingPath], 'session-a', '/shops/shared'), sessionOwner);
});

test('shop selection uses an exact path fallback and stays empty without a known workspace', () => {
    const shop = { workspaceId: 'shop-a', path: '/shops/shop-a' };
    assert.equal(shopForSession([shop], 'new-session', '/shops/shop-a'), shop);
    assert.equal(shopForSession([shop], undefined, '/shops/shop-a'), shop);
    for (const cwd of [undefined, '', '/shops/shop', '/shops/shop-a/subdirectory', '/shops/other'])
        assert.equal(shopForSession([shop], 'unknown-session', cwd), undefined);
    assert.equal(shopForSession([], 'session-a', '/shops/shop-a'), undefined);
    assert.equal(shopForSession([{ ...shop, sessionIds: [] }], undefined, undefined), undefined);
});

test('review references require successful results and the owning session shop', () => {
    for (const [tool, ref] of [['zhuanleme_draft', entryRef], ['zhuanleme_change', proposalRef], ['zhuanleme_rules', proposalRef]]) {
        const block = resultBlock({ id: ref.id, status: 'pending', review: ref });
        assert.deepEqual(reviewReference(tool, block, 'shop-a'), ref);
        assert.equal(reviewReference(tool, block, 'shop-b'), null);
        assert.equal(reviewReference(tool, block, undefined), null);
        assert.equal(reviewReference(tool, { ...block, isError: true }, 'shop-a'), null);
        assert.equal(reviewReference(tool, resultBlock({ id: 'different-id', review: ref }), 'shop-a'), null);
        assert.equal(reviewReference(tool, resultBlock({ id: ref.id, review: { ...ref, type: 'wrong' } }), 'shop-a'), null);
    }
    assert.equal(reviewReference('zhuanleme_report', resultBlock({ id: entryRef.id, review: entryRef }), 'shop-a'), null);
    assert.equal(reviewReference('zhuanleme_draft', { content: resultBlock({ id: entryRef.id }).content }, 'shop-a'), null);
    for (const block of [null, 'tool-result', 42, []]) assert.equal(reviewReference('zhuanleme_draft', block, 'shop-a'), null);
});

test('legacy result ids use their session shop and malformed tool output is not actionable', () => {
    assert.deepEqual(reviewReference('zhuanleme_draft', resultBlock({ id: 'entry-a' }), 'shop-a'), entryRef);
    assert.deepEqual(reviewReference('zhuanleme_change', resultBlock({ id: 'proposal-a' }), 'shop-a'), proposalRef);
    assert.equal(reviewReference('zhuanleme_draft', resultBlock({ id: 'entry-a' }), undefined), null);
    for (const value of [null, [], 'entry-a', {}, { id: '' }, { id: 42 }, { id: 'entry-a', review: null }])
        assert.equal(reviewReference('zhuanleme_draft', resultBlock(value), 'shop-a'), null);
    for (const content of [undefined, [], [null], [{ type: 'text', text: '{' }], [{ type: 'image' }], [{ type: 'text', text: '{"id":"entry-a"}' }, { type: 'text', text: '{}' }]])
        assert.equal(reviewReference('zhuanleme_draft', { kind: 'tool-result', content }, 'shop-a'), null);
});

test('turn review cards select only tool results located in the requested turn', () => {
    const previousRef = { ...entryRef, id: 'previous-entry' };
    const snapshot = turnSnapshot({
        1: [toolNode(callResult('zhuanleme_draft', previousRef))],
        2: [{ kind: 'text', data: 'assistant explanation' }, toolNode(callResult('zhuanleme_draft', entryRef)), undefined],
    });
    assert.deepEqual(turnReviewReferences(snapshot, 2, 'shop-a'), [entryRef]);
    assert.deepEqual(turnReviewReferences(snapshot, 1, 'shop-a'), [previousRef]);
    assert.deepEqual(turnReviewReferences(snapshot, 3, 'shop-a'), []);
});

test('turn review cards include native results and recursively nested PTC subcalls', () => {
    const rulesRef = { ...proposalRef, id: 'rules-proposal' };
    const native = toolNode(callResult('zhuanleme_draft', entryRef));
    const ptc = toolNode({
        ...callResult('run', { ...entryRef, id: 'ignored-wrapper' }),
        subCalls: [{ name: 'parallel_dispatch', subCalls: [
            callResult('zhuanleme_change', proposalRef),
            { ...callResult('run', { ...entryRef, id: 'ignored-nested-wrapper' }), subCalls: [callResult('zhuanleme_rules', rulesRef)] },
        ] }],
    });
    assert.deepEqual(turnReviewReferences(turnSnapshot({ 1: [native, ptc] }), 1, 'shop-a'), [entryRef, proposalRef, rulesRef]);
});

test('turn review cards deduplicate retries while retaining distinct entry and proposal identities', () => {
    const sameIdProposal = { ...entryRef, type: 'proposal' };
    const snapshot = turnSnapshot({ 1: [
        toolNode(callResult('zhuanleme_draft', entryRef)),
        toolNode({ name: 'run', subCalls: [callResult('zhuanleme_draft', entryRef), callResult('zhuanleme_change', sameIdProposal)] }),
        toolNode(callResult('zhuanleme_change', sameIdProposal)),
    ] });
    assert.deepEqual(turnReviewReferences(snapshot, 1, 'shop-a'), [entryRef, sameIdProposal]);
});

test('failed, running, unrelated, and other-shop calls do not produce turn review cards', () => {
    const snapshot = turnSnapshot({ 1: [
        toolNode({ ...callResult('zhuanleme_draft', entryRef), isError: true }),
        toolNode({ name: 'zhuanleme_draft', content: resultBlock({ id: entryRef.id, review: entryRef }).content }),
        toolNode(callResult('zhuanleme_report', entryRef)),
        toolNode(callResult('zhuanleme_rules', { ...proposalRef, shop: 'shop-b' })),
    ] });
    assert.deepEqual(turnReviewReferences(snapshot, 1, 'shop-a'), []);
    assert.deepEqual(turnReviewReferences(turnSnapshot({ 1: [toolNode(callResult('zhuanleme_draft', entryRef))] }), 1, 'shop-b'), []);
});

test('review responses validate identity, money, versions, proposal details, and terminal states', () => {
    for (const status of ['draft', 'posted', 'void']) assert.equal(validReview(entryResponse({ status }), entryRef), true);
    for (const status of ['pending', 'applied', 'rejected']) assert.equal(validReview(proposalResponse({ status }), proposalRef), true);
    assert.equal(validReview(proposalResponse({ action: 'void', entry: undefined }), proposalRef), true);
    assert.equal(validReview(proposalResponse({ type: 'rules', rules: [rule], before: [] }), proposalRef), true);
    for (const value of [null, [], {}, { ...entryResponse(), shop: { id: 'shop-b', title: 'Other' } }, { ...entryResponse(), type: 'proposal' }, entryResponse({ id: 'entry-b' }), entryResponse({ version: 0 }), entryResponse({ version: '7' }), entryResponse({ amount: -1 }), entryResponse({ amount: 0.5 }), entryResponse({ amount: Number.MAX_SAFE_INTEGER + 1 }), entryResponse({ note: null }), entryResponse({ day: 'today' }), entryResponse({ kind: 'refund' }), entryResponse({ status: 'pending' })])
        assert.equal(validReview(value, entryRef), false);
    for (const value of [proposalResponse({ status: 'draft' }), proposalResponse({ before: null }), proposalResponse({ action: 'confirm' }), proposalResponse({ entry: undefined }), proposalResponse({ type: 'rules', rules: [], before: [] }), proposalResponse({ type: 'rules', rules: [rule], before: null }), proposalResponse({ type: 'rules', rules: [{ ...rule, effective: 'today' }], before: [] }), proposalResponse({ type: 'rules', rules: [rule], before: [null] })])
        assert.equal(validReview(value, proposalRef), false);
});

test('draft confirmation sends the displayed version and reloads the posted result', async () => {
    const calls = [], changes = [];
    let posted = false;
    const model = createReviewModel(entryRef, { changed: shop => changes.push(shop), request: async (input, signal) => {
        calls.push({ input, signal });
        if (input.op === 'review') return entryResponse(posted ? { status: 'posted', version: 8 } : {});
        posted = true;
        return { id: 'entry-a' };
    } });
    try {
        await model.load();
        assert.equal(model.getSnapshot().data.item.version, 7);
        await model.resolve('confirm');
        assert.deepEqual(calls.map(c => c.input), [{ op: 'review', ...entryRef }, { op: 'change', shop: 'shop-a', id: 'entry-a', version: 7, action: 'confirm' }, { op: 'review', ...entryRef }]);
        assert.ok(calls[0].signal instanceof AbortSignal);
        assert.deepEqual(changes, ['shop-a']);
        assert.equal(model.getSnapshot().data.item.status, 'posted');
        assert.equal(model.getSnapshot().busy, false);
        assert.equal(model.getSnapshot().error, null);
        await model.resolve('confirm');
        await model.resolve('reject');
        assert.equal(calls.length, 3);
    } finally { model.dispose(); }
});

test('discarding a draft uses its version and the ledger void action', async () => {
    const calls = [];
    const model = createReviewModel(entryRef, { request: async input => {
        calls.push(input);
        return input.op === 'review' ? entryResponse(calls.length > 1 ? { status: 'void', version: 8 } : {}) : { id: 'entry-a' };
    } });
    try {
        await model.load();
        await model.resolve('reject');
        assert.deepEqual(calls[1], { op: 'change', shop: 'shop-a', id: 'entry-a', version: 7, action: 'void' });
        assert.equal(model.getSnapshot().data.item.status, 'void');
    } finally { model.dispose(); }
});

test('entry and rule proposals resolve through their proposal identity', async () => {
    for (const type of ['entry', 'rules']) for (const action of ['confirm', 'reject']) {
        const calls = [], changes = [];
        let settled = false;
        const model = createReviewModel(proposalRef, { changed: shop => changes.push(shop), request: async input => {
            calls.push(input);
            if (input.op === 'review') return proposalResponse({ ...(type === 'rules' ? { type: 'rules', rules: [rule], before: [] } : {}), status: settled ? action === 'confirm' ? 'applied' : 'rejected' : 'pending' });
            settled = true;
            return { id: 'proposal-a', status: action === 'confirm' ? 'applied' : 'rejected' };
        } });
        try {
            await model.load();
            await model.resolve(action);
            assert.deepEqual(calls[1], { op: 'proposal', shop: 'shop-a', id: 'proposal-a', action });
            assert.equal(model.getSnapshot().data.item.status, action === 'confirm' ? 'applied' : 'rejected');
            assert.deepEqual(changes, ['shop-a']);
            await model.resolve(action);
            assert.equal(calls.length, 3);
        } finally { model.dispose(); }
    }
});

test('concurrent clicks submit one mutation and cannot switch a pending decision', async () => {
    const commit = deferred(), calls = [];
    let posted = false;
    const model = createReviewModel(entryRef, { request: async input => {
        calls.push(input);
        if (input.op === 'review') return entryResponse(posted ? { status: 'posted', version: 8 } : {});
        await commit.promise;
        posted = true;
        return { id: 'entry-a' };
    } });
    try {
        await model.resolve('confirm');
        assert.equal(calls.length, 0);
        await model.load();
        await model.resolve('invalid-action');
        assert.equal(calls.length, 1);
        const confirming = model.resolve('confirm');
        assert.equal(model.getSnapshot().busy, true);
        await model.resolve('confirm');
        await model.resolve('reject');
        assert.equal(calls.length, 2);
        commit.resolve();
        await confirming;
        assert.equal(calls.filter(c => c.op === 'change').length, 1);
        assert.equal(model.getSnapshot().busy, false);
    } finally { commit.resolve(); model.dispose(); }
});

test('a version conflict preserves the error and refreshes the content before a new confirmation', async () => {
    const calls = [], changes = [];
    let attempt = 0;
    const model = createReviewModel(entryRef, { changed: shop => changes.push(shop), request: async input => {
        calls.push(input);
        if (input.op === 'review') return entryResponse(attempt === 0 ? {} : { version: attempt === 1 ? 8 : 9, amount: 90000, status: attempt === 1 ? 'draft' : 'posted' });
        if (++attempt === 1) throw new Error('账目已更新，请刷新后再操作');
        return { id: 'entry-a' };
    } });
    try {
        await model.load();
        await model.resolve('confirm');
        assert.match(model.getSnapshot().error, /已更新/);
        assert.equal(model.getSnapshot().data.item.version, 8);
        assert.equal(model.getSnapshot().data.item.amount, 90000);
        assert.equal(model.getSnapshot().busy, false);
        assert.deepEqual(changes, []);
        await model.resolve('confirm');
        assert.deepEqual(calls.filter(c => c.op === 'change').map(c => c.version), [7, 8]);
        assert.equal(model.getSnapshot().error, null);
        assert.equal(model.getSnapshot().data.item.status, 'posted');
        assert.deepEqual(changes, ['shop-a']);
    } finally { model.dispose(); }
});

test('malformed review responses leave no confirmable item', async () => {
    const calls = [];
    const model = createReviewModel(entryRef, { invalidMessage: 'Invalid review data', request: async input => {
        calls.push(input);
        return { ...entryResponse(), shop: { id: 'shop-b', title: 'Wrong shop' } };
    } });
    try {
        await model.load();
        assert.equal(model.getSnapshot().data, null);
        assert.equal(model.getSnapshot().error, 'Invalid review data');
        assert.equal(model.getSnapshot().loading, false);
        await model.resolve('confirm');
        assert.equal(calls.length, 1);
    } finally { model.dispose(); }
});

test('a newer load aborts the old request and ignores its late result', async () => {
    const pending = [], notifications = [];
    const model = createReviewModel(entryRef, { request: (input, signal) => {
        const item = { ...deferred(), input, signal };
        pending.push(item);
        return item.promise;
    } });
    const unsubscribe = model.subscribe(() => notifications.push(model.getSnapshot()));
    try {
        const first = model.load(), second = model.load();
        assert.equal(pending[0].signal.aborted, true);
        assert.equal(pending[1].signal.aborted, false);
        pending[1].resolve(entryResponse({ version: 9, amount: 90000 }));
        await second;
        const current = model.getSnapshot(), count = notifications.length;
        pending[0].resolve(entryResponse());
        await first;
        assert.equal(model.getSnapshot(), current);
        assert.equal(model.getSnapshot().data.item.version, 9);
        assert.equal(notifications.length, count);
        unsubscribe();
        const third = model.load();
        pending[2].resolve(entryResponse({ version: 10 }));
        await third;
        assert.equal(notifications.length, count);
    } finally { unsubscribe(); model.dispose(); }
});

test('a focus refresh blocks confirmation until the current ledger version is displayed', async () => {
    const refreshing = deferred(), calls = [];
    let reads = 0;
    const model = createReviewModel(entryRef, { request: input => {
        calls.push(input);
        if (input.op !== 'review') return Promise.resolve({ id: 'entry-a' });
        if (++reads === 2) return refreshing.promise;
        return Promise.resolve(entryResponse(reads > 2 ? { status: 'posted', version: 9 } : {}));
    } });
    try {
        await model.load();
        const focused = model.load();
        assert.equal(model.getSnapshot().loading, true);
        await model.resolve('confirm');
        assert.equal(calls.length, 2);
        refreshing.resolve(entryResponse({ version: 8, amount: 90000 }));
        await focused;
        assert.equal(model.getSnapshot().data.item.amount, 90000);
        await model.resolve('confirm');
        assert.deepEqual(calls[2], { op: 'change', shop: 'shop-a', id: 'entry-a', version: 8, action: 'confirm' });
    } finally { refreshing.resolve(entryResponse()); model.dispose(); }
});

test('disposal aborts pending loads, prevents publications, and does not start new requests', async () => {
    const pending = deferred(), calls = [], notifications = [];
    const model = createReviewModel(entryRef, { request: (input, signal) => { calls.push({ input, signal }); return pending.promise; } });
    model.subscribe(() => notifications.push(model.getSnapshot()));
    const loading = model.load();
    model.dispose();
    const snapshot = model.getSnapshot(), count = notifications.length;
    assert.equal(calls[0].signal.aborted, true);
    pending.resolve(entryResponse());
    await loading;
    await model.load();
    await model.resolve('confirm');
    assert.equal(model.getSnapshot(), snapshot);
    assert.equal(notifications.length, count);
    assert.equal(calls.length, 1);
});

test('a mutation that completes after disposal does not start a refresh', async () => {
    const commit = deferred(), calls = [];
    const model = createReviewModel(entryRef, { request: input => {
        calls.push(input);
        return input.op === 'review' ? Promise.resolve(entryResponse()) : commit.promise;
    } });
    await model.load();
    const confirming = model.resolve('confirm');
    model.dispose();
    const snapshot = model.getSnapshot();
    commit.resolve({ id: 'entry-a' });
    await confirming;
    assert.equal(model.getSnapshot(), snapshot);
    assert.equal(calls.length, 2);
});
