import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { installImageRecognition, parseRecognition, imageRoute } from '../src/image-recognition.mjs';

const receipt = { document_type: 'receipt', date: null, merchant: null, currency: 'CNY', items: [{ name: '白菜', quantity: '4', unit: '斤', unit_price: '5', amount: '20' }], total: '20', uncertain_fields: ['date'] };
function fixture(output = JSON.stringify(receipt), failure) {
    const handlers = new Map(), calls = [], events = [], controller = new AbortController();
    const agent = { id: 'session', session: { header: { cwd: '/shop' }, snapshotEvents: () => events,
        append(type, data, metadata = {}) { const event = { seq: events.length + 1, type, data, ...metadata }; events.push(event); return event; } } };
    const ctx = { on(name, fn) { handlers.set(name, fn); }, workspaceRegistry: { resolveByPath: async cwd => cwd === '/shop' ? { sessionIds: ['session'] } : null },
        llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), async prepareCall(config) { return { config, async *stream(options) {
            calls.push(options); if (failure) { yield { type: 'finish', reason: { kind: 'error', failure: { code: failure } } }; return; }
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text: output };
            yield { type: 'block-end', index: 0, block: { type: 'text', text: output } };
            yield { type: 'finish', reason: { kind: 'stop' } };
        } }; } } };
    installImageRecognition(ctx);
    const step = (messages, kind = 'enter') => handlers.get('agent/pre-step')({ agent, signal: controller.signal }, async () => ({ kind, messages }));
    const admitsImage = native => handlers.get('session/image-input')({ agent }, async () => native);
    return { calls, events, step, agent, controller, admitsImage };
}
const imageMessage = () => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '记录这个采购' }, { type: 'image', attachment: { id: 'receipt' } }] });

test('vision branch returns structured facts without a model-selection/request hook', async () => {
    const f = fixture(), original = imageMessage();
    const result = await f.step([original]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].provider, imageRoute.provider);
    assert.equal(f.calls[0].model, 'qwen3.7-flash-2026-07-15');
    assert.equal(f.calls[0].reasoningEffort, 'off');
    assert.deepEqual(f.calls[0].tools, []);
    assert.equal(result.messages[0].id, original.id);
    assert.equal(result.messages[0].content[1].offloaded, true);
    assert.equal(original.content[1].offloaded, undefined, 'Original immutable upload is preserved');
    assert.equal(result.messages[1].source.kind, 'zhuanleme-image-recognition');
    assert(result.messages[1].content[0].text.includes(JSON.stringify(receipt)));
    assert.deepEqual(f.events.map(event => event.type), ['zhuanleme/image-request', 'zhuanleme/image-result']);
    assert(f.events.every(event => event.ignorable === true), 'Auxiliary records stay readable without the plugin vocabulary');
    await f.step([original]);
    assert.equal(f.calls.length, 1, 'Successful recognition is reused on admission retry');
    await f.step(result.messages);
    assert.equal(f.calls.length, 1, 'Historical processed images do not trigger recognition');
    f.agent.session.header.cwd = '/other';
    assert.deepEqual((await f.step([imageMessage()])).messages.length, 1);
    assert.equal(f.calls.length, 1);
});

test('malformed and failed recognition cannot become invented ledger facts', async () => {
    for (const f of [fixture('not JSON'), fixture('', 'MISSING_CREDENTIAL')]) {
        const result = await f.step([imageMessage()]);
        assert.equal(result.messages[0].content[1].offloaded, true);
        assert.match(result.messages[1].content[0].text, /不能生成臆测账目/);
        assert.equal(f.events.at(-1).data.status, 'error');
        assert.equal(f.events.at(-1).data.result, undefined);
    }
    const f = fixture();
    await f.step([imageMessage()], 'reject');
    assert.equal(f.calls.length, 0);
    f.controller.abort();
    await f.step([imageMessage()]);
    assert.equal(f.calls.length, 0);
});

test('switching recognition models does not reuse the previous model result', async () => {
    const f = fixture(), message = imageMessage();
    await f.step([message]);
    f.events[0].data.config = { ...f.events[0].data.config, model: 'qwen3-vl-flash' };
    await f.step([message]);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].model, 'qwen3.7-flash-2026-07-15');
});

test('recognition policy changes invalidate prior results and retain every item row', async () => {
    const second = { ...receipt.items[0], quantity:'3', unit_price:'6', amount:'18' };
    const itemized = { ...receipt, items:[receipt.items[0], second], total:'38' };
    const f = fixture(JSON.stringify(itemized)), message = imageMessage();
    await f.step([message]);
    assert.deepEqual(f.events.at(-1).data.result.items, itemized.items, 'Same-named receipt lines remain distinct');
    f.events[0].data.system = '旧的整单识别规则';
    const result = await f.step([message]);
    assert.equal(f.calls.length, 2);
    assert.match(result.messages[1].content[0].text, /按items逐行分别生成草稿/);
    assert.match(result.messages[1].content[0].text, /total仅用于核对/);
});

test('vision schema preserves unknowns and rejects invalid monetary fields', () => {
    assert.deepEqual(parseRecognition(JSON.stringify(receipt)), receipt);
    assert.throws(() => parseRecognition(JSON.stringify({ ...receipt, total: '20元' })));
    assert.throws(() => parseRecognition(JSON.stringify({ ...receipt, items: [{ ...receipt.items[0], amount: 20 }] })));
});

test('image admission accepts the shop preprocessor without changing the native model', async () => {
    const f = fixture();
    assert.equal(await f.admitsImage(false), true);
    assert.equal(f.calls.length, 0, 'Admission does not spend an inference call');
    f.agent.session.header.cwd = '/unrelated';
    assert.equal(await f.admitsImage(false), false);
    assert.equal(await f.admitsImage(true), true, 'Native image capability is preserved');
});
