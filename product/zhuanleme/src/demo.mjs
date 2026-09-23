import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Persistent, explicitly synthetic retail shop; never seeds an existing user shop. */
export async function createDemoManager(dir, registry, ledger) {
    const path = join(dir, 'demo-shop.json');
    let marker;
    try { marker = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let pending;
    const seed = async () => {
        let workspace = marker && registry.get(marker.id);
        if (!workspace) {
            const folder = join(dir, 'shops', randomUUID());
            await mkdir(folder, { recursive: true });
            workspace = await registry.create(folder, '演示店 · 青禾生活');
            marker = { id: workspace.id, day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) };
            await writeFile(path, JSON.stringify(marker), 'utf8');
        }
        const day = marker.day;
        const dateAt = n => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
        if (!ledger.rules(workspace.id).length) ledger.setRules(workspace.id, [
            { category: 'materials', method: 'percent', value: '54', base: 'all' },
            { category: 'labor', method: 'monthly', value: '18000' },
            { category: 'rent', method: 'monthly', value: '12000' },
            { category: 'utilities', method: 'monthly', value: '2400' },
            { category: 'platform', method: 'percent', value: '6', base: 'meituan' },
            { category: 'other', method: 'daily', value: '95' }
        ].map(rule => ({ ...rule, effective: dateAt(6) })));
        const exists = ledger.db.prepare('SELECT 1 FROM entries WHERE shop=? AND request=?');
        const add = (key, data, status) => { const request = `demo:${key}`; if (!exists.get(workspace.id, request)) ledger.add(workspace.id, { ...data, request }, status); };
        [6820, 7440, 7120, 8260, 9650, 10380, 8920].forEach((total, i) => {
            const date = dateAt(6 - i), online = Math.round(total * .28);
            add(`${date}:store`, { day: date, kind: 'revenue', channel: 'store', amount: String(total - online), note: '虚拟数据 · 门店当日销售汇总' });
            add(`${date}:online`, { day: date, kind: 'revenue', channel: 'meituan', amount: String(online), note: '虚拟数据 · 即时零售销售汇总' });
        });
        for (const [i, amount, note] of [[1, '1260', '咖啡豆与茶饮补货'], [2, '480', '纸品与日用百货'], [3, '760', '冷藏饮品补货'], [4, '320', '收银耗材与包装袋']]) add(`purchase:${i}`, { day, kind: 'purchase', amount, note: `虚拟数据 · ${note}` });
        add('actual:utilities', { day, kind: 'actual', category: 'utilities', amount: '86', note: '虚拟数据 · 当日水电分摊核对' });
        return { workspace: { id: workspace.id, title: workspace.title, path: workspace.path }, day, demo: true };
    };
    return {
        isDemo: id => marker?.id === id,
        ensure() { if (!pending) pending = seed().finally(() => { pending = undefined; }); return pending; }
    };
}
