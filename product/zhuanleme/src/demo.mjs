import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const businessDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const shiftDay = (day, count) => new Date(Date.parse(day) + count * 86400000).toISOString().slice(0, 10);
const money = cents => (cents / 100).toFixed(2);
const income = [
    ['store', '09:20', '早餐面包与现磨咖啡', 13], ['store', '11:35', '鲜奶与日常食品', 12],
    ['store', '13:10', '午间轻食与饮品', 11], ['store', '15:40', '下午茶与休闲零食', 10],
    ['store', '18:15', '晚间日用百货', 8], ['store', '20:30', '晚间门店零售', 6],
    ['meituan', '10:45', '即时零售 · 饮品订单', 7], ['meituan', '12:50', '即时零售 · 午间订单', 8],
    ['meituan', '17:25', '即时零售 · 日用补给', 6], ['meituan', '20:10', '即时零售 · 晚间订单', 7],
    ['douyin', '14:20', '团购套餐核销', 7], ['douyin', '19:40', '团购饮品核销', 5],
];
/** Persistent synthetic retail data, confined to the marked demo shop and topped up through today. */
export async function createDemoManager(dir, registry, ledger) {
    const path = join(dir, 'demo-shop.json');
    let marker, pending, seededThrough;
    try { marker = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const seed = async () => {
        const day = businessDay();
        let workspace = marker && registry.get(marker.id);
        if (!workspace) {
            const folder = join(dir, 'shops', randomUUID());
            await mkdir(folder, { recursive: true });
            workspace = await registry.create(folder, '演示店 · 青禾生活');
            marker = { id: workspace.id, day };
            await writeFile(path, JSON.stringify(marker), 'utf8');
        }
        const result = { workspace: { id: workspace.id, title: workspace.title, path: workspace.path }, day, demo: true };
        if (seededThrough === day) return result;
        const id = workspace.id, from = shiftDay(day, -89);
        ledger.transaction(() => {
            if (!ledger.rules(id).length) ledger.setRules(id, [
                { category: 'materials', method: 'percent', value: '46', base: 'all' },
                { category: 'labor', method: 'monthly', value: '25200' },
                { category: 'rent', method: 'monthly', value: '12600' },
                { category: 'utilities', method: 'daily', value: '190' },
                { category: 'platform', method: 'percent', value: '12', base: 'meituan' },
                { category: 'other', method: 'daily', value: '180' },
            ].map(rule => ({ ...rule, effective: from })));
            const settings = ledger.settings(id);
            if (!settings.channels) ledger.setSettings(id, { channels: ['store', 'meituan', 'douyin'] });
            const enabled = ledger.settings(id).channels;
            const existing = ledger.rows(id), byDay = new Map();
            for (const row of existing) {
                if (!byDay.has(row.day)) byDay.set(row.day, []);
                byDay.get(row.day).push(row);
            }
            const exists = ledger.db.prepare('SELECT 1 FROM entries WHERE shop=? AND request=?');
            const add = (key, data) => {
                const request = `demo:v2:${key}`;
                if (!exists.get(id, request)) ledger.add(id, { ...data, request, settlement: 'paid', account: data.kind === 'revenue' ? '演示收款账户' : '演示经营账户' });
            };
            for (let i = 0; i < 90; i++) {
                const date = shiftDay(from, i), serial = Math.floor(Date.parse(date) / 86400000), weekday = new Date(date).getUTCDay();
                // Absolute dates keep amounts stable when tomorrow's rolling window advances.
                const total = Math.round(([10800, 7850, 7520, 8180, 8640, 9780, 12250][weekday] + Math.sin(serial * .71) * 480 + Math.cos(serial * .19) * 320) * 100);
                const previous = byDay.get(date) || [];
                let allocated = 0;
                income.forEach(([channel, time, note, share], index) => {
                    const amount = index === income.length - 1 ? total - allocated : Math.round(total * share / 100);
                    allocated += amount;
                    // A user's summary, edit or void remains authoritative for its entire channel.
                    if (enabled.includes(channel) && !previous.some(row => row.kind === 'revenue' && row.channel === channel))
                        add(`${date}:sale:${index}`, { day: date, time, kind: 'revenue', channel, mode: 'transaction', amount: money(amount), note: `虚拟数据 · ${note}` });
                });
                const costs = [
                    ['materials', Math.round(total * (.46 + Math.sin(serial * .37) * .025)), '22:05', '商品耗用成本'],
                    ['labor', (840 + (weekday === 0 || weekday === 6 ? 160 : 0)) * 100, '22:10', '人员排班与工资分摊'],
                    ['rent', 42000, '22:12', '店铺租金分摊'],
                    ['utilities', (178 + Math.round((Math.sin(serial * .53) + 1) * 28)) * 100, '22:15', '水电与冷藏设备费用'],
                    ['platform', Math.round(total * .4 * .12), '22:18', '即时零售与团购服务费'],
                    ['other', (150 + Math.round((Math.cos(serial * .41) + 1) * 45)) * 100, '22:20', '包装耗材与店务杂费'],
                ];
                for (const [category, amount, time, note] of costs) {
                    if (!previous.some(row => row.kind === 'actual' && row.category === category))
                        add(`${date}:cost:${category}`, { day: date, time, kind: 'actual', costCoverage:'complete',costTiming:'daily', category, mode: 'transaction', amount: money(amount), note: `虚拟数据 · ${note}` });
                }
                for (const [index, note, factor, time] of [
                    [0, '咖啡豆与茶饮原料', .14, '08:15'], [1, '鲜奶与冷藏饮品', .095, '08:40'],
                    [2, '面包零食与日用百货', .19, '10:10'], [3, '包装纸品与收银耗材', .025, '16:30'],
                ]) add(`${date}:purchase:${index}`, { day: date, time, kind: 'purchase', amount: money(Math.round(total * factor * (1 + Math.sin(serial + index) * .18))), note: `虚拟数据 · ${note}`, details: '模拟补货单；采购不等于当日耗用成本' });
                // Only wholly generated days are automatically reconciled; later user edits stay unclosed.
                if (!previous.length) ledger.closeDay(id, date, enabled);
            }
        });
        seededThrough = day;
        return result;
    };
    const ensure = () => {
        if (!pending) pending = seed().finally(() => { pending = undefined; });
        return pending;
    };
    return {
        isDemo: id => marker?.id === id,
        ensure,
        refresh: () => marker && registry.get(marker.id) ? ensure() : Promise.resolve(null),
    };
}
