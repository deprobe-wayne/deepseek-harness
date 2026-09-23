export const incomeTypes = ['store', 'meituan', 'douyin', 'other'].map(c => `revenue:${c}`);
export const expenseTypes = ['purchase', ...['materials', 'labor', 'rent', 'utilities', 'platform', 'other'].map(c => `actual:${c}`)];
export const typeLabel = (value, t) => value.split(':').map(k => t(k)).join(' · ');
export const tableRows = (entries, day, section, includeDrafts = false) => entries.filter(row => row.day === day && (row.status === 'posted' || includeDrafts && row.status === 'draft') && (section === 'income' ? row.kind === 'revenue' : ['purchase', 'actual'].includes(row.kind))).map(row => ({ ...row, dateTime: [row.day,row.time].filter(Boolean).join(' '), amount: (row.amount / 100).toFixed(2), type: [row.kind, row.category || row.channel].filter(Boolean).join(':') }));
/** Prefer a populated tab on first open; never treat purchases as income. */
export function initialSection(entries, day, includeDrafts = false) {
    return tableRows(entries, day, 'income', includeDrafts).length === 0 && tableRows(entries, day, 'expenses', includeDrafts).length > 0 ? 'expenses' : 'income';
}
export const blankRow = (day, section) => ({ id: 'new', day, dateTime: day, time: '', mode: 'transaction', note: '', amount: '', type: section === 'income' ? incomeTypes[0] : expenseTypes[0] });
export function savePayload(row, request, t) {
    if(row.dateTime !== undefined) {
        const match=String(row.dateTime).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?)?$/);
        if(!match || !Number.isFinite(Date.parse(match[1]+'T00:00:00Z')) || new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10)!==match[1]) throw new Error(t('dateTimeError'));
        row={...row,day:match[1],time:match[2]?[match[2],match[3],match[4]].filter(Boolean).join(':'):''};
    }
    if (!row.day || row.amount === '') throw new Error(t('gridRequired'));
    const amount = String(row.amount).trim();
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount)) throw new Error(t('gridAmountError'));
    const [kind, scope] = row.type.split(':');
    return { op: row.id === 'new' ? 'add' : 'change', day: row.day, refundOf:row.refundOf || '', settlement:row.settlement || 'unknown', account:row.account||'', note: row.note ?? '', time: row.time || '', mode: row.mode || 'summary', amount, kind, category: kind === 'actual' ? scope : null, channel: kind === 'revenue' ? scope : null, request, ...(row.id === 'new' ? {} : { id: row.id, version: row.version, action: 'edit' }) };
}
// Spreadsheet applications must interpret user-written notes as text, never formulas.
export const exportText = value => /^[\s]*[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value ?? '');
