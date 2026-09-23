/** One request generation owns loading and stale-result rejection. */
export async function api(body, signal) { const response = await fetch('/api/zhuanleme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }); const value = await response.json(); if (!response.ok)
    throw new Error(value.error || '保存失败'); return value; }
/**
 * Workspace membership remains authoritative when cwd contains a symlink or path alias.
 * @param workspaces - Official workspace projections.
 * @param sessionId - Viewed session identity.
 * @param cwd - Optional exact-path fallback for an unassociated session.
 * @returns The associated workspace, or undefined when none matches.
 */
export function shopForSession(workspaces, sessionId, cwd) {
    return workspaces.find(workspace => workspace.sessionIds?.includes(sessionId))
        ?? workspaces.find(workspace => cwd && workspace.path === cwd);
}
export function createModel() {
    let snapshot = { shop: null, day: null, data: null, error: null, loading: false }, generation = 0, controller;
    const listeners = new Set();
    const publish = patch => { snapshot = { ...snapshot, ...patch }; for (const fn of listeners)
        fn(); };
    return {
        getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        async load(shop, day, quiet = false) {
            const version = ++generation;
            controller?.abort();
            controller = new AbortController();
            publish({ shop, day, ...(snapshot.shop !== shop ? { data: null } : {}), loading: !quiet, error: null });
            if (!shop) {
                publish({ data: null, loading: false });
                return;
            }
            try {
                const r = await fetch(`/api/zhuanleme?shop=${encodeURIComponent(shop)}&day=${day}`, { signal: controller.signal });
                const data = await r.json();
                if (!r.ok)
                    throw new Error(data.error);
                if (version === generation)
                    publish({ data, loading: false });
            }
            catch (e) {
                if (version === generation && e.name !== 'AbortError')
                    publish({ error: e.message, loading: false });
            }
        }, dispose() { generation++; controller?.abort(); listeners.clear(); }
    };
}

/** Plugin-owned navigation shared through Slot observable injection. */
export function createNavigation() {
    let snapshot = { shopId: null, view: 'home' };
    const listeners = new Set();
    return {
        getSnapshot: () => snapshot,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        select(shopId, view) { snapshot = { shopId, view }; for (const fn of listeners) fn(); },
        dispose() { listeners.clear(); }
    };
}
