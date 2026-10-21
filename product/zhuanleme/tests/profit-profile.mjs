import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createUserMessage} from '../../../packages/llm/llm/lib/index.js';
import {Ledger,categories} from '../src/ledger.mjs';
/** Record new profit fields through the real agent loop and canonical tool outputs. */
export async function verifyProfitProfile(ctx,ScriptedModel){
 const folder=join(ctx.profileContext.dir,'profit-shop');await mkdir(folder,{recursive:true});const workspace=await ctx.workspaceRegistry.create(folder,'利润核算验收店');
 const ledger=new Ledger(join(ctx.profileContext.dir,'zhuanleme/ledger.sqlite')),day='2026-09-01';
 try{
  ledger.setSettings(workspace.id,{channels:['meituan']});ledger.setRules(workspace.id,categories.map(category=>({category,method:category==='rent'?'monthly':category==='materials'||category==='platform'?'percent':'daily',value:category==='rent'?'6000.01':category==='materials'?'31.5':category==='platform'?'6':'0',...(category==='platform'?{base:'meituan'}:category==='materials'?{base:'all'}:{}),effective:day})));
  const draft=args=>({name:'zhuanleme_draft',args:{day,request:args.request,...args}});
  const model=new ScriptedModel([
   ()=>draft({kind:'revenue',channel:'meituan',amount:'940',revenueBasis:'net',platformFee:'60',request:'net'}),
   ()=>draft({kind:'actual',category:'materials',amount:'20',costCoverage:'partial',request:'partial'}),
   ()=>draft({kind:'actual',category:'rent',amount:'6000.01',costCoverage:'complete',costTiming:'period',costFrom:day,costTo:'2026-09-30',request:'rent'}),
  ]);
  ctx.llm.registerAdapter(['zlm-profit'],model);
  const {agent}=await ctx.agentLoop.createAgent(ctx,{sessionId:'zlm-profit',agentOptions:{provider:'zlm-profit',model:'audit'},meta:{cwd:folder},setup:async c=>{await ctx.agentPresets.mount(c,'zhuanleme');}});await workspace.attachSession(agent.id);
  async function turn(text){const idle=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{dispose();reject(Error('Profit profile timed out'));},20000);const dispose=ctx.on('agent/status',({agent:subject,status})=>{if(subject.id===agent.id&&status==='idle'){clearTimeout(timer);dispose();resolve();}});});agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await idle;assert.notEqual(agent.session.snapshotEvents().filter(e=>e.type==='turn/end').at(-1)?.data.reason.kind,'error');}
  await turn('准备净到账940元，已扣费60元；材料只有20元部分明细；九月完整房租6000.01元按整月分摊。');
  const confirm=()=>{const items=ledger.rows(workspace.id).filter(row=>row.status==='draft').map(({id,version})=>({id,version}));ledger.resolveEntries(workspace.id,{items,action:'confirm'});ledger.closeDay(workspace.id,day,['meituan']);};
  confirm();model.steps=[()=>({name:'zhuanleme_report',args:{day}})];await turn('查询这一天利润并说明完整性。');
  model.steps=[()=>draft({kind:'actual',category:'materials',amount:'295',costCoverage:'complete',request:'remainder'})];await turn('补入其余材料295元，确认当日材料合计315元且全部已录全。');confirm();
  model.steps=[()=>({name:'zhuanleme_report',args:{day}}),()=>({name:'zhuanleme_period',args:{from:day,to:day}})];await turn('重新查询日报和期间报表，核对净到账与月付费用没有重复扣减。');
  const events=agent.session.snapshotEvents(),transcript=events.filter(e=>e.type==='tool/result').flatMap(event=>{assert.equal(event.data.message.isError,false);const value=JSON.parse(event.data.message.content[0].text),s=value.summary||value.days?.[0];return s?[{revenue:s.revenue,cost:s.cost,profit:s.profit,profitStatus:s.profitStatus,partialCosts:s.partialCosts,costs:s.costs.map(r=>({category:r.category,amount:r.amount,basis:r.basis}))}]:[];});
  assert.equal(transcript[0].profit,null);assert.equal(transcript[0].profitStatus,'incomplete');assert.equal(transcript.at(-1).profit,42499);assert.equal(transcript.at(-1).profitStatus,'verified');
  const file=new URL('./expected/profit-accuracy-transcript.json',import.meta.url);if(process.env.ZLM_RECORD_EXPECTED==='1')await writeFile(file,JSON.stringify(transcript,null,2)+'\n');else assert.deepEqual(transcript,JSON.parse(await readFile(file,'utf8')));
  await writeFile(join(ctx.profileContext.dir,'profit-accuracy-session.json'),JSON.stringify(events,null,2));
 }finally{ledger.close();}
}
