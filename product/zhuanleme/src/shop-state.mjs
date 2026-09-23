import { DatabaseSync } from 'node:sqlite';
/** Reversible shop removal preserves workspace identity, conversations and ledger rows. */
export function createShopState(file, registry, isRunning = () => false) {
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS deleted_shops (id TEXT PRIMARY KEY)');
    const deleted = id => Boolean(db.prepare('SELECT id FROM deleted_shops WHERE id=?').get(id));
    const snapshot = () => ({ deleted: db.prepare('SELECT id FROM deleted_shops').all().map(r => r.id) });
    return { deleted, close: () => db.close(), handle(input) {
        if (!['shop-state','shop-delete','shop-restore'].includes(input.op)) return null;
        if (input.op === 'shop-state') return snapshot();
        const shop = typeof input.shop === 'string' && registry.get(input.shop);
        if (!shop) throw new Error('店铺不存在');
        if (input.op === 'shop-delete') {
            if (shop.sessionIds?.some(isRunning)) throw new Error('店铺内仍有对话运行，请停止后再删除');
            db.prepare('INSERT OR IGNORE INTO deleted_shops(id) VALUES (?)').run(input.shop);
        } else db.prepare('DELETE FROM deleted_shops WHERE id=?').run(input.shop);
        return snapshot();
    } };
}
