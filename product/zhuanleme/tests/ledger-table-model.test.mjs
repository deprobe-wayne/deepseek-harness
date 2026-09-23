import { initialSection } from '../src/client/ledger-table-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { Ledger } from '../src/ledger.mjs';
import { tableRows, blankRow, savePayload, exportText } from '../src/client/ledger-table-model.mjs';
const day = '2026-09-22', t = key => key;
test('table mutations and AI drafts share the versioned ledger, with stale edit protection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zlm-table-')), ledger = new Ledger(join(dir, 'ledger.sqlite'));
    try {
        const added = savePayload({ ...blankRow(day, 'expenses'), note: '咖啡豆', amount: '860.25' }, 'manual-1', t);
        const id = ledger.add('shop', added);
        const ai = ledger.add('shop', { day, kind: 'revenue', channel: 'store', amount: '1200', source: 'ai', request: 'ai-1' }, 'draft');
        assert.equal(tableRows(ledger.report('shop', day).entries, day, 'income').length, 0);
        ledger.change('shop', { id: ai, version: 1, action: 'confirm' });
        const expenses = tableRows(ledger.report('shop', day).entries, day, 'expenses');
        assert.equal(expenses.length, 1); assert.equal(expenses[0].amount, '860.25');
        const change = savePayload({ ...expenses[0], amount: '900.12' }, 'edit-1', t);
        ledger.change('shop', change);
        assert.throws(() => ledger.change('shop', change));
        assert.equal(tableRows(ledger.report('shop', day).entries, day, 'income')[0].amount, '1200.00');
        ledger.change('shop', { id, version: 2, action: 'void' });
        assert.equal(tableRows(ledger.report('shop', day).entries, day, 'expenses').length, 0);
        assert.equal(ledger.report('shop', day).entries.find(row => row.id === id).status, 'void');
    } finally { ledger.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('table adapter rejects invalid amounts before mutation', () => {
    for (const amount of ['-1', '1.001', '1e3', '', 'NaN']) assert.throws(() => savePayload({ ...blankRow(day, 'income'), note: 'test', amount }, 'id', t));
    assert.equal(savePayload({ ...blankRow(day, 'income'), note: 'test', amount: '0' }, 'id', t).amount, '0');
});
test('spreadsheet notes remain inert text and money stays numeric through XLSX export', () => {
    const notes = ['=HYPERLINK("https://example.com")', ' +1', '-2', '@SUM(A1)', '普通备注'];
    const sheet = XLSX.utils.aoa_to_sheet([['项目', '金额'], ...notes.map(note => [exportText(note), 1234.56])]);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '收入');
    const restored = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    assert.equal(restored.Sheets['收入'].A2.t, 's'); assert.equal(restored.Sheets['收入'].A2.f, undefined);
    assert.equal(restored.Sheets['收入'].B2.v, 1234.56);
    assert.equal(restored.Sheets['收入'].A6.v, '普通备注');
    const csv = XLSX.utils.sheet_to_csv(sheet); assert.match(csv, /'=HYPERLINK/);
});

test('combined date editor preserves business date and optional time for the shared ledger',()=>{
 const row={...blankRow(day,'income'),amount:'10',dateTime:'2026-09-20 11:45:30'};
 const saved=savePayload(row,'combined',t);assert.equal(saved.day,'2026-09-20');assert.equal(saved.time,'11:45:30');
 assert.equal(savePayload({...row,dateTime:'2026-09-20'},'date-only',t).time,'');
 for(const dateTime of ['2026-02-30','2026-13-01','2026-09-20 25:00'])assert.throws(()=>savePayload({...row,dateTime},'invalid',t));
 const display=tableRows([{...saved,id:'one',amount:1000,status:'posted'}],'2026-09-20','income')[0];assert.equal(display.dateTime,'2026-09-20 11:45:30');
});

test('opening a day with only posted expenses selects expenses, excluding drafts and voided rows', () => {
    const entries=[{id:'potato',day:'2026-09-22',kind:'purchase',status:'posted',amount:50000,note:'土豆'}, {id:'old',day:'2026-09-22',kind:'revenue',status:'void',amount:80000}];
    assert.equal(initialSection(entries,'2026-09-22'),'expenses');
    assert.equal(tableRows(entries,'2026-09-22','expenses')[0].amount,'500.00');
    assert.equal(initialSection(entries,'2026-09-23'),'income');
    assert.equal(initialSection([{...entries[0],status:'draft'}],'2026-09-22'),'income');
    assert.equal(initialSection([{...entries[0],status:'draft'}],'2026-09-22',true),'expenses');
    assert.equal(initialSection([...entries,{...entries[0],kind:'revenue'}],'2026-09-22'),'income');
});
