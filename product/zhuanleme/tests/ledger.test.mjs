import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, cents, date, dailyShare, categories, summarize } from '../src/ledger.mjs';
const day = '2026-09-21';
const zeroRules = () => categories.map(category => ({ category, method: 'daily', value: '0', base: 'all', effective: '2026-09-01' }));
const income = (request, amount = '8200') => ({ day, kind: 'revenue', channel: 'store', amount, request });
test('money and dates reject ambiguous input', () => { assert.equal(cents('12.09'), 1209); for (const value of ['-1', '1.001', 'NaN', '1e4', '1,000'])
    assert.throws(() => cents(value)); assert.throws(() => date('2026-02-30')); });
test('monthly cents sum exactly in February and a 31-day month', () => { for (const [month, days] of [['2024-02', 29], ['2026-01', 31]])
    assert.equal(Array.from({ length: days }, (_, i) => dailyShare(100001, `${month}-${String(i + 1).padStart(2, '0')}`)).reduce((a, b) => a + b, 0), 100001); });
test('persistent ledger isolates shops, drafts, purchases, and versions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zlm-')), path = join(dir, 'ledger.sqlite');
    let l = new Ledger(path);
    try {
        const id = l.add('a', income('r1'));
        assert.equal(l.add('a', income('r1')), id);
        assert.throws(() => l.add('a', income('r1', '20')));
        assert.throws(() => l.add('a', income('r2')));
        assert.equal(l.report('b', day).entries.length, 0);
        assert.equal(l.report('a', day).summary.profit, null);
        l.setRules('a', zeroRules().map(r => r.category === 'materials' ? { ...r, method: 'percent', value: '30' } : r));
        assert.equal(l.report('a', day).summary.profit, 574000);
        l.add('a', { day, kind: 'purchase', amount: '9000', request: 'p' });
        assert.equal(l.report('a', day).summary.profit, 574000);
        const draft = l.add('a', { day, kind: 'actual', category: 'materials', amount: '2000', request: 'ai', source: 'ai' }, 'draft');
        assert.equal(l.report('a', day).summary.profit, 574000);
        assert.throws(() => l.change('b', { id: draft, version: 1, action: 'confirm' }));
        l.change('a', { id: draft, version: 1, action: 'confirm' });
        assert.equal(l.report('a', day).summary.profit, 620000);
        assert.throws(() => l.change('a', { id: draft, version: 1, action: 'void' }));
        l.change('a', { id: draft, version: 2, action: 'edit', day, kind: 'actual', category: 'materials', amount: '2500' });
        assert.equal(l.report('a', day).summary.profit, 570000);
        l.change('a', { id: draft, version: 3, action: 'void' });
        assert.equal(l.report('a', day).summary.profit, 574000);
        l.close();
        l = new Ledger(path);
        assert.equal(l.report('a', day).summary.profit, 574000);
        assert.equal(l.db.prepare('SELECT count(*) AS n FROM audit').get().n, 7);
    }
    finally {
        l.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('channel fees require a declared base and actuals replace the same category only', () => {
    const rows = [{ id: 'r', day, kind: 'revenue', channel: 'store', amount: 10000, status: 'posted' }];
    const rules = categories.map((category, seq) => ({ seq, category, effective: day, method: 'daily', value: 0 }));
    rules[4] = { ...rules[4], method: 'percent', base: 'meituan', value: 800 };
    assert.equal(summarize(day, rows, rules).profit, null);
    rows.push({ id: 'm', day, kind: 'revenue', channel: 'meituan', amount: 20000, status: 'posted' });
    assert.equal(summarize(day, rows, rules).profit, 28400);
    rules.push({ ...rules[0], seq: 7, effective: '2026-09-22', value: 999 });
    assert.equal(summarize(day, rows, rules).profit, 28400);
});
test('an explicitly zero percent cost is known even without that revenue channel', () => {
    const rows = [{ id: 'r', day, kind: 'revenue', channel: 'store', amount: 10000, status: 'posted' }];
    const rules = categories.map((category, seq) => ({ seq, category, effective: day, method: 'daily', value: 0 }));
    rules[4] = { ...rules[4], method: 'percent', base: 'meituan' };
    assert.equal(summarize(day, rows, rules).cost, 0);
    assert.equal(summarize(day, rows, rules).profit, 10000);
    assert.equal(summarize(day, [], rules).cost, 0);
    assert.equal(summarize(day, [], rules).profit, null);
    rules[4].value = 1;
    assert.equal(summarize(day, rows, rules).cost, null);
});
test('manual rules reject a stale form without overwriting confirmed changes', () => {
    const l = new Ledger(':memory:');
    try {
        const version = l.rulesVersion('a');
        l.setRules('a', zeroRules(), version);
        const proposed = l.propose('a', { type: 'rules', version: l.rulesVersion('a'), rules: [{ category: 'rent', method: 'monthly', value: '3000', effective: day }], request: 'rent' });
        const openFormVersion = l.rulesVersion('a');
        l.resolveProposal('a', { id: proposed.id, action: 'confirm' });
        const confirmedVersion = l.rulesVersion('a');
        const auditCount = l.db.prepare('SELECT count(*) AS n FROM audit').get().n;
        assert.throws(() => l.setRules('a', zeroRules(), openFormVersion), /已更新/);
        assert.equal(l.rulesVersion('a'), confirmedVersion);
        assert.equal(l.report('a', day).summary.costs.find(c => c.category === 'rent').amount, 10000);
        assert.equal(l.db.prepare('SELECT count(*) AS n FROM audit').get().n, auditCount);
        for (const invalid of [-1, 1.5, '7']) assert.throws(() => l.setRules('a', zeroRules(), invalid), /版本/);
        l.setRules('b', zeroRules(), 0);
        l.setRules('a', zeroRules().map(r => ({ ...r, effective: day })), confirmedVersion);
        assert.equal(l.report('a', day).summary.cost, 0);
    } finally { l.close(); }
});
test('AI change proposals are isolated, retryable, reviewed, and version checked', () => {
    const l = new Ledger(':memory:');
    try {
        const id = l.add('a', { day, kind: 'purchase', amount: '860', request: 'seed' });
        const edit = { type: 'entry', id, version: 1, action: 'edit', day, kind: 'purchase', amount: '820', request: 'edit' };
        const p = l.propose('a', edit);
        assert.deepEqual(l.propose('a', edit), p);
        assert.throws(() => l.propose('a', { ...edit, amount: '810' }));
        assert.throws(() => l.propose('b', edit));
        assert.throws(() => l.resolveProposal('b', { id: p.id, action: 'confirm' }));
        assert.equal(l.report('a', day).summary.purchases, 86000);
        l.resolveProposal('a', { id: p.id, action: 'confirm' });
        l.resolveProposal('a', { id: p.id, action: 'confirm' });
        assert.equal(l.rows('a')[0].version, 2);
        assert.equal(l.report('a', day).summary.purchases, 82000);
        assert.equal(l.propose('a', edit).status, 'applied');
        const stale = l.propose('a', { ...edit, version: 2, request: 'stale' });
        l.change('a', { ...edit, version: 2, amount: '900' });
        assert.throws(() => l.resolveProposal('a', { id: stale.id, action: 'confirm' }), /已更新/);
        assert.equal(l.proposals('a').find(p => p.id === stale.id).status, 'pending');
        l.resolveProposal('a', { id: stale.id, action: 'reject' });
        assert.equal(l.report('a', day).proposals.length, 0);
        const rule = { type: 'rules', version: 0, rules: [{ category: 'rent', method: 'monthly', value: '3000', effective: day }], request: 'rent' };
        const rp = l.propose('a', rule);
        assert.equal(l.rules('a').length, 0);
        l.resolveProposal('a', { id: rp.id, action: 'confirm' });
        assert.equal(l.rules('a').length, 1);
        assert.equal(l.report('a', day).summary.costs.find(c => c.category === 'rent').amount, 10000);
        assert.equal(l.report('a', day).summary.cost, null); // Other five categories stay missing.
        const other = l.propose('a', { ...rule, version: l.rulesVersion('a'), request: 'other' });
        l.setRules('a', zeroRules());
        assert.throws(() => l.resolveProposal('a', { id: other.id, action: 'confirm' }), /已更新/);
        assert.throws(() => l.propose('a', { ...rule, rules: [], request: 'empty' }));
    } finally { l.close(); }
});
test('pending proposals survive restart, conflicts roll back, and unknown newer schemas are refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zlm-schema-')), path = join(dir, 'ledger.sqlite');
    let l = new Ledger(path);
    try {
        const first = l.add('a', income('first'));
        const second = l.add('a', { ...income('second'), channel:'meituan' });
        const proposed = l.propose('a', { ...income('proposal'), type:'entry', id:second, version:1, action:'edit' });
        l.close(); l = new Ledger(path);
        assert.equal(l.report('a', day).proposals[0].id, proposed.id);
        assert.throws(() => l.resolveProposal('a', {id:proposed.id,action:'confirm'}), /已有汇总记录/);
        assert.equal(l.rows('a').find(r => r.id === second).channel, 'meituan');
        assert.equal(l.proposals('a')[0].status, 'pending');
        assert.equal(l.rows('a').find(r => r.id === first).version, 1);
        l.db.exec('PRAGMA user_version=3');
        assert.throws(() => new Ledger(path), /升级插件/);
    } finally { l.close(); rmSync(dir, {recursive:true,force:true}); }
});
test('entry creation retries retain the original request identity after edits and restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zlm-retry-')), path = join(dir, 'ledger.sqlite');
    let l = new Ledger(path);
    try {
        const submitted = { day, kind: 'purchase', amount: '860', request: 'original', source: 'ai' };
        const id = l.add('a', submitted, 'draft');
        l.change('a', { ...submitted, id, version: 1, action: 'edit', amount: '820' });
        l.change('a', { id, version: 2, action: 'confirm' });
        l.close(); l = new Ledger(path);
        assert.equal(l.add('a', submitted, 'draft'), id);
        assert.throws(() => l.add('a', { ...submitted, amount: '820' }, 'draft'), /不同内容/);
        assert.equal(l.rows('a').length, 1);
        assert.equal(l.report('a', day).summary.purchases, 82000);
        assert.equal(l.rows('a')[0].version, 3);
        assert.equal(l.db.prepare('SELECT count(*) AS n FROM audit').get().n, 3);
        l.change('a', { id, version: 3, action: 'void' });
        assert.equal(l.add('a', submitted, 'draft'), id);
        assert.equal(l.report('a', day).summary.purchases, 0);
        assert.equal(l.rows('a')[0].status, 'void');
    } finally { l.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('lost confirmation and cancellation responses can be retried without replaying stale actions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zlm-confirm-')), path = join(dir, 'ledger.sqlite');
    let l = new Ledger(path);
    try {
        const submitted = { day, kind: 'purchase', amount: '860', request: 'draft', source: 'ai' };
        const id = l.add('a', submitted, 'draft');
        const confirm = { id, version: 1, action: 'confirm' };
        assert.equal(l.change('a', confirm), id);
        l.close(); l = new Ledger(path);
        assert.equal(l.change('a', confirm), id);
        assert.equal(l.rows('a')[0].version, 2);
        assert.equal(l.db.prepare('SELECT count(*) AS n FROM audit').get().n, 2);
        assert.throws(() => l.change('b', confirm), /不存在/);
        l.change('a', { ...submitted, id, version: 2, action: 'edit', amount: '820' });
        assert.throws(() => l.change('a', confirm), /已更新/);
        assert.throws(() => l.change('a', { ...confirm, version: 2 }), /已更新/);
        assert.throws(() => l.change('a', { id, version: 2, action: 'void' }), /已更新/);
        const cancel = { id, version: 3, action: 'void' };
        assert.equal(l.change('a', cancel), id);
        assert.equal(l.change('a', cancel), id);
        assert.equal(l.rows('a')[0].version, 4);
        assert.equal(l.report('a', day).summary.purchases, 0);
        assert.equal(l.db.prepare('SELECT count(*) AS n FROM audit').get().n, 4);
        assert.throws(() => l.change('a', { ...cancel, version: 4 }), /已撤销/);
    } finally { l.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('undo reverses saved edits, deletions and additions with monotonic versions and safe retry', () => {
    const l = new Ledger(':memory:');
    try {
        const id = l.add('a', income('undo-add', '100'));
        const added = l.mutationResult('a', id).undo;
        l.change('a', { ...income('unused', '120'), id, version: 1, action: 'edit' });
        const edited = l.mutationResult('a', id).undo;
        l.change('a', { id, version: 2, action: 'void' });
        const deleted = l.mutationResult('a', id).undo;
        l.undo('a', deleted);
        assert.equal(l.rows('a')[0].status, 'posted');
        l.undo('a', deleted);
        assert.equal(l.rows('a')[0].version, 4);
        l.undo('a', { ...edited, version: 4 });
        assert.equal(l.rows('a')[0].amount, 10000);
        l.undo('a', { ...added, version: 5 });
        assert.equal(l.rows('a')[0].status, 'void');
        assert.equal(l.rows('a')[0].version, 6);
    } finally { l.close(); }
});
test('undo cannot overwrite concurrent model edits, cross shops or duplicate posted income', () => {
    const l = new Ledger(':memory:');
    try {
        const id = l.add('a', income('guard-add', '100'));
        const token = l.mutationResult('a', id).undo;
        assert.throws(() => l.undo('b', token), /无法找到/);
        l.change('a', { ...income('unused', '130'), id, version: 1, action: 'edit' });
        assert.throws(() => l.undo('a', token), /已有新修改/);
        l.change('a', { id, version: 2, action: 'void' });
        const deleted = l.mutationResult('a', id).undo;
        l.add('a', income('replacement', '200'));
        assert.throws(() => l.undo('a', deleted));
        assert.equal(l.rows('a').find(row => row.id === id).status, 'void');
        assert.equal(l.rows('a').find(row => row.id === id).version, 3);
    } finally { l.close(); }
});
