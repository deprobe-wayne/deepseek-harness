import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger.mjs';
import { createDemoManager } from '../src/demo.mjs';
test('retail demo stays isolated and repeated activation preserves edits', async () => {
 const dir=await mkdtemp(join(tmpdir(),'zlm-demo-')), ledger=new Ledger(join(dir,'ledger.sqlite')), shops=new Map();
 const registry={get:id=>shops.get(id),create:async(path,title)=>{const w={id:'demo-shop',path,title};shops.set(w.id,w);return w;}};
 try {
  const demo=await createDemoManager(dir,registry,ledger);
  const [a,b]=await Promise.all([demo.ensure(),demo.ensure()]);assert.equal(a.workspace.id,b.workspace.id);
  const report=ledger.report(a.workspace.id,a.day);assert.equal(report.summary.revenue,892000);assert.equal(report.trend.length,7);assert.ok(report.summary.profit>0);assert.equal(report.summary.purchases,282000);
  assert.equal(ledger.rows('real-shop').length,0);assert.equal(demo.isDemo('real-shop'),false);
  const row=report.entries.find(r=>r.kind==='purchase');ledger.change(a.workspace.id,{id:row.id,version:row.version,action:'void'});
  const count=ledger.rows(a.workspace.id).length;const reopened=await createDemoManager(dir,registry,ledger);await reopened.ensure();
  assert.equal(shops.size,1);assert.equal(ledger.rows(a.workspace.id).length,count);assert.equal(ledger.rows(a.workspace.id).find(r=>r.id===row.id).status,'void');assert.equal(reopened.isDemo(a.workspace.id),true);
 } finally {ledger.close();await rm(dir,{recursive:true,force:true});}
});
