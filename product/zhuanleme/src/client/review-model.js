import { api } from './model.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;

/**
 * Only successful persisted tool results can identify a reviewable ledger item.
 * @param toolName - Registered business tool name.
 * @param block - Official running or settled tool projection.
 * @param shopId - Workspace belonging to the viewed session.
 * @returns Validated review identity, or null when confirmation cannot be offered.
 */
export function reviewReference(toolName, block, shopId) {
    const type = toolName === 'zhuanleme_draft' ? 'entry' : ['zhuanleme_change', 'zhuanleme_rules'].includes(toolName) ? 'proposal' : null;
    if (!type || !record(block) || !('kind' in block) || block.isError || !Array.isArray(block.content)) return null;
    const texts = block.content.filter(c => record(c) && c.type === 'text');
    if (texts.length !== 1) return null;
    let result;
    try { result = JSON.parse(texts[0].text); } catch { return null; }
    if (!record(result) || !nonempty(result.id)) return null;
    const ref = result.review;
    // Legacy results carry an id but no shop; the owning session supplies its workspace.
    if (ref === undefined) return nonempty(shopId) ? { shop: shopId, type, id: result.id } : null;
    if (!record(ref) || !nonempty(ref.shop) || ref.type !== type || ref.id !== result.id || ref.shop !== shopId) return null;
    return { shop: ref.shop, type, id: ref.id };
}

/**
 * Select this turn's unique review identities from the official projected call trees.
 * @param snapshot - Current official chat snapshot.
 * @param turn - Turn number containing the tool results.
 * @param shopId - Workspace belonging to the viewed session.
 * @returns Unique review identities in call order, including PTC children.
 */
export function turnReviewReferences(snapshot, turn, shopId) {
    const refs = new Map();
    const visit = block => {
        const name = ('kind' in block ? block.call?.name : block.name) || '';
        const ref = reviewReference(name, block, shopId);
        if (ref) refs.set(`${ref.type}/${ref.id}`, ref);
        for (const child of block.subCalls || []) visit(child);
    };
    for (const key of snapshot.locations.getTurn(turn)) {
        const node = snapshot.nodes.get(key);
        if (node?.kind === 'tool-call') visit(node.data.root);
    }
    return [...refs.values()];
}

const validEntry = value => record(value) && /^\d{4}-\d{2}-\d{2}$/.test(value.day) && ['revenue', 'purchase', 'actual'].includes(value.kind) && Number.isSafeInteger(value.amount) && value.amount >= 0 && typeof value.note === 'string';
const validRule = value => record(value) && ['materials','labor','rent','utilities','platform','other'].includes(value.category) && ['daily','monthly','percent'].includes(value.method) && Number.isSafeInteger(value.value) && value.value >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(value.effective);

/**
 * Reject mismatched or malformed responses before enabling a confirmation action.
 * @param value - Parsed API response.
 * @param ref - Identity resolved from the persisted tool result.
 * @returns Whether the displayed fields and record identity can be used for review.
 */
export function validReview(value, ref) {
    if (!record(value) || value.shop?.id !== ref.shop || typeof value.shop.title !== 'string' || value.type !== ref.type || !record(value.item) || value.item.id !== ref.id) return false;
    const item = value.item;
    if (ref.type === 'entry') return validEntry(item) && ['draft','posted','void'].includes(item.status) && Number.isSafeInteger(item.version) && item.version > 0;
    if (!['pending','applied','rejected'].includes(item.status)) return false;
    if (item.type === 'entry') return validEntry(item.before) && ['edit','void'].includes(item.action) && (item.action === 'void' || validEntry(item.entry));
    return item.type === 'rules' && Array.isArray(item.rules) && item.rules.length > 0 && item.rules.every(validRule) && Array.isArray(item.before) && item.before.every(validRule);
}

/**
 * A card owns its request generation and submits exactly the version shown to the user.
 * @param ref - Immutable shop and item identity.
 * @param dependencies - API transport, change notification and localized read error.
 * @returns Observable review state with load, resolution and disposal operations.
 */
export function createReviewModel(ref, { request = api, changed = () => {}, invalidMessage = '无法读取核对内容，请重新生成建议。' } = {}) {
    let state = { data: null, loading: true, busy: false, error: null }, generation = 0, disposed = false, controller;
    const listeners = new Set();
    const publish = patch => { if (disposed) return; state = { ...state, ...patch }; for (const fn of listeners) fn(); };
    async function load() {
        if (disposed) return;
        const version = ++generation;
        controller?.abort();
        controller = new AbortController();
        publish({ loading: true });
        try {
            const data = await request({ op: 'review', ...ref }, controller.signal);
            if (!validReview(data, ref)) throw new Error(invalidMessage);
            if (version === generation) publish({ data, loading: false });
        } catch (error) {
            if (version === generation && error.name !== 'AbortError') publish({ loading: false, error: error.message, data: null });
        }
    }
    return {
        getSnapshot: () => state,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        load,
        async resolve(action) {
            if (disposed || state.busy || state.loading || !state.data) return;
            const item = state.data.item;
            if (ref.type === 'entry' ? item.status !== 'draft' : item.status !== 'pending') return;
            if (!['confirm','reject'].includes(action)) return;
            publish({ busy: true, error: null });
            try {
                await request(ref.type === 'entry'
                    ? { op: 'change', shop: ref.shop, id: ref.id, version: item.version, action: action === 'confirm' ? 'confirm' : 'void' }
                    : { op: 'proposal', shop: ref.shop, id: ref.id, action });
                changed(ref.shop);
            } catch (error) { publish({ error: error.message }); }
            finally { await load(); publish({ busy: false }); }
        },
        dispose() { disposed = true; generation++; controller?.abort(); listeners.clear(); },
    };
}
