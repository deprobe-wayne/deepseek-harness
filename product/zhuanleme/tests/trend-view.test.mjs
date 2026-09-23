import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/client/model.js';
test('changing the selected day retains the mounted chart data until new figures arrive',async t=>{
 let resolveNext;
 const first={summary:{revenue:100},trend:[{day:'2026-09-22',revenue:100}]};
 t.mock.method(globalThis,'fetch',async url=>url.includes('2026-09-22')?Response.json(first):new Promise(resolve=>{resolveNext=resolve;}));
 const model=createModel();try{
 await model.load('shop','2026-09-22');
 const changing=model.load('shop','2026-09-19');
 assert.equal(model.getSnapshot().day,'2026-09-19');assert.deepEqual(model.getSnapshot().data,first);assert.equal(model.getSnapshot().loading,true);
 resolveNext(Response.json({summary:{revenue:200},trend:[{day:'2026-09-19',revenue:200}]}));await changing;
 assert.equal(model.getSnapshot().data.summary.revenue,200);assert.equal(model.getSnapshot().loading,false);
 }finally{model.dispose();}
});
