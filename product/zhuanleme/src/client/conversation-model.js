/**
 * Group the shop's complete conversation history without mixing archived and deleted rows.
 * @param workspace - Workspace with authoritative ordered Session membership.
 * @param sessions - Session summaries keyed by id.
 * @param archivedSessionIds - Official registry archive set.
 * @param deletedSessionIds - Plugin's durable, reversible deletion set.
 * @param pinnedSessionIds - Durable pin order, newest pin first.
 * @returns Three ordered lists of known top-level conversations.
 */
export function groupConversations(workspace, sessions, archivedSessionIds = [], deletedSessionIds = [], pinnedSessionIds = []) {
    const archived = new Set(archivedSessionIds), deleted = new Set(deletedSessionIds);
    const groups = { active: [], archived: [], deleted: [] };
    for (const id of new Set(workspace.sessionIds || [])) {
        const session = sessions[id];
        if (!session || session.origin === 'subagent') continue;
        groups[deleted.has(id) ? 'deleted' : archived.has(id) ? 'archived' : 'active'].push({ ...session, id });
    }
    const pins = new Map(pinnedSessionIds.map((id, index) => [id, index]));
    groups.active.sort((a,b) => (pins.get(a.id) ?? Infinity) - (pins.get(b.id) ?? Infinity));
    return groups;
}

/**
 * Bind sidebar actions to official archive navigation and profile-local reversible deletion.
 * @param dependencies - Product API and official Workspace navigation service.
 * @returns Observable deletion state, refresh, mutation callbacks, and listener disposal.
 */
export function createConversationActions({ api, navigation }) {
    let snapshot = { deletedSessionIds: [], pinnedSessionIds: [], loading: true, error: null }, generation = 0, disposed = false;
    const listeners = new Set(), pending = new Map();
    const publish = patch => { if (disposed) return; snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
    const load = async () => {
        const version = ++generation;
        try {
            const state = await api({ op: 'conversation-state' });
            if (version === generation) publish({ ...state, loading: false, error: null });
        } catch (error) { if (version === generation) publish({ loading: false, error: error.message }); }
    };
    const once = (id, action) => {
        if (pending.has(id)) return pending.get(id);
        const request = Promise.resolve().then(action).finally(() => pending.delete(id));
        pending.set(id, request);
        return request;
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        load,
        pinSession: (id, shop, pinned) => once(id, async () => { await api({ op: 'conversation-pin', sessionId: id, shop, pinned }); await load(); }),
        archiveSession: id => once(id, () => navigation.archiveSession(id)),
        unarchiveSession: id => once(id, () => navigation.unarchiveSession(id)),
        deleteSession: (id, shop) => once(id, async () => {
            await api({ op: 'conversation-delete', sessionId: id, shop });
            // The idempotent official action also clears the current selection before resolving.
            try { await navigation.archiveSession(id); } finally { await load(); }
        }),
        restoreSession: (id, shop) => once(id, async () => { await api({ op: 'conversation-restore', sessionId: id, shop }); await load(); }),
        dispose() { disposed = true; generation++; listeners.clear(); },
    };
}
