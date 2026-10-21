import { api } from './model.js';

/** Keep mode selection scoped to one conversation; failed saves retain the accepted mode.
 * @param identity Current shop and session.
 * @param request Authenticated transport.
 * @returns Observable state, read/write operations and cancellation.
 */
export function createAssistantModeModel(identity, request = api) {
    let state = { mode: null, loading: true, busy: false, error: null }, disposed = false, generation = 0, controller;
    const listeners = new Set();
    const publish = patch => { if (disposed) return; state = { ...state, ...patch }; for (const fn of listeners) fn(); };
    async function send(mode) {
        const current = ++generation;
        controller?.abort(); controller = new AbortController();
        publish({ ...(mode ? { busy: true } : { loading: true }), error: null });
        try {
            const result = await request({ op: 'assistant-mode', ...identity, ...(mode ? { mode } : {}) }, controller.signal);
            if (!['record', 'analysis'].includes(result.mode)) throw new Error('Invalid assistant mode');
            if (current === generation) publish({ mode: result.mode, loading: false, busy: false });
        } catch (error) {
            if (current === generation && error.name !== 'AbortError') publish({ error: error.message, loading: false, busy: false });
        }
    }
    return {
        getSnapshot: () => state,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        load: () => state.busy ? Promise.resolve() : send(),
        select: mode => state.busy || state.loading || mode === state.mode ? Promise.resolve() : send(mode),
        dispose() { disposed = true; generation++; controller?.abort(); listeners.clear(); },
    };
}
