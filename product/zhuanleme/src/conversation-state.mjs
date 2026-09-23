import { DatabaseSync } from 'node:sqlite';

const operations = new Set(['conversation-state', 'conversation-delete', 'conversation-restore', 'conversation-pin']);

/**
 * Persist reversible conversation removal separately from the shop ledger and Session logs.
 * @param file - Profile-local SQLite file.
 * @param registry - Official Workspace registry; archive membership remains its responsibility.
 * @param options - Host running-state observation used before hiding an active conversation.
 * @returns Serialized route handler and an asynchronous close that drains admitted operations.
 */
export function createConversationState(file, registry, { isRunning = () => false } = {}) {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS deleted_conversations (session_id TEXT PRIMARY KEY, shop TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS pinned_conversations (session_id TEXT PRIMARY KEY, shop TEXT NOT NULL)');
    let tail = Promise.resolve(), closed = false;
    const snapshot = () => ({ deletedSessionIds: db.prepare('SELECT session_id FROM deleted_conversations ORDER BY rowid').all().map(row => row.session_id), pinnedSessionIds: db.prepare('SELECT session_id FROM pinned_conversations ORDER BY rowid DESC').all().map(row => row.session_id) });
    const requireMembership = input => {
        if (typeof input.shop !== 'string' || typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 500)
            throw new Error('请提供有效的店铺和对话');
        const workspace = registry.get(input.shop);
        if (!workspace?.sessionIds.includes(input.sessionId)) throw new Error('该对话不属于当前店铺，请刷新后重试');
    };
    return {
        handle(input) {
            if (!operations.has(input.op)) return Promise.resolve(null);
            if (closed) return Promise.reject(new Error('对话服务已关闭，请重新加载页面'));
            const result = tail.then(async () => {
                if (input.op === 'conversation-state') return snapshot();
                requireMembership(input);
                if (input.op === 'conversation-pin') {
                    if (typeof input.pinned !== 'boolean') throw new Error('请提供置顶状态');
                    if (input.pinned) db.prepare('INSERT OR IGNORE INTO pinned_conversations(session_id,shop) VALUES (?,?)').run(input.sessionId, input.shop);
                    else db.prepare('DELETE FROM pinned_conversations WHERE session_id=? AND shop=?').run(input.sessionId, input.shop);
                    return snapshot();
                }
                const previous = db.prepare('SELECT shop FROM deleted_conversations WHERE session_id=?').get(input.sessionId);
                if (previous && previous.shop !== input.shop) throw new Error('对话的店铺归属已变化，请刷新后重试');
                if (input.op === 'conversation-delete') {
                    if (isRunning(input.sessionId)) throw new Error('对话仍在处理中，请等待完成或停止后再移至已删除');
                    await registry.archiveSession(input.sessionId);
                    db.prepare('INSERT OR IGNORE INTO deleted_conversations(session_id,shop) VALUES (?,?)').run(input.sessionId, input.shop);
                } else if (previous) {
                    await registry.unarchiveSession(input.sessionId);
                    db.prepare('DELETE FROM deleted_conversations WHERE session_id=? AND shop=?').run(input.sessionId, input.shop);
                }
                return snapshot();
            });
            // Each caller receives its failure; later operations still get a queue slot.
            tail = result.then(() => undefined, () => undefined);
            return result;
        },
        async close() { if (closed) return; closed = true; await tail; db.close(); },
    };
}
