import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createUserMessage } from '../../../packages/llm/llm/lib/index.js';
import { Ledger, categories } from '../src/ledger.mjs';

/** Record the model-visible refund report and SQL pages through the real Profile agent loop. */
export async function verifyReliabilityProfile(ctx, ScriptedModel) {
    const folder=join(ctx.profileContext.dir,'reliability-shop');
    await mkdir(folder,{recursive:true});
    const workspace=await ctx.workspaceRegistry.create(folder,'退款与分页验收店');
    const ledger=new Ledger(join(ctx.profileContext.dir,'zhuanleme/ledger.sqlite'));
    const day='2026-10-14';
    try {
        const original=ledger.add(workspace.id,{day:'2026-10-13',kind:'revenue',channel:'store',mode:'transaction',amount:'100',request:'sale'});
        ledger.add(workspace.id,{day,kind:'revenue',channel:'store',mode:'transaction',amount:'100',refundOf:original,request:'refund'});
        ledger.add(workspace.id,{day,kind:'purchase',amount:'5',request:'purchase'});
        ledger.setRules(workspace.id,categories.map(category=>({category,method:category==='platform'?'percent':'daily',value:category==='platform'?'10':'0',base:'all',effective:day})),0);
        ledger.setSettings(workspace.id,{channels:['store']});ledger.closeDay(workspace.id,day,['store']);
        const model=new ScriptedModel([
            ()=>({name:'zhuanleme_report',args:{day}}),
            ()=>({name:'zhuanleme_period',args:{from:day,to:day,offset:0,limit:1}}),
            ()=>({name:'zhuanleme_period',args:{from:day,to:day,offset:1,limit:1}}),
        ]);
        model.answer='当天净收入为 -100 元，按 10% 计算的平台费用为 -10 元；采购记录 5 元不计作当天耗用成本。';
        ctx.llm.registerAdapter(['zlm-reliability'],model);
        const {agent}=await ctx.agentLoop.createAgent(ctx,{sessionId:'zlm-reliability',agentOptions:{provider:'zlm-reliability',model:'audit'},meta:{cwd:folder},setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,'zhuanleme');}});
        await workspace.attachSession(agent.id);
        const idle=new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{dispose();reject(new Error('Reliability snapshot timed out'));},20000);
            const dispose=ctx.on('agent/status',({agent:subject,status})=>{if(subject.id===agent.id&&status==='idle'){clearTimeout(timer);dispose();resolve();}});
        });
        agent.followup(createUserMessage({content:[{type:'text',text:'查询退款日的经营数据，再分两页查询该日账目。'}],source:{kind:'user'}}));
        await idle;
        const events=agent.session.snapshotEvents();
        assert.notEqual(events.filter(e=>e.type==='turn/end').at(-1)?.data.reason.kind,'error');
        const results=events.filter(e=>e.type==='tool/result');assert.equal(results.length,3);
        const transcript=results.map(event=>{
            assert.equal(event.data.message.isError,false);
            const value=JSON.parse(event.data.message.content[0].text);
            const call=events.find(e=>e.type==='tool/call'&&e.data.callId===event.data.message.toolCallId);
            const s=value.summary||value.days[0];
            return {tool:call.data.name,summary:{day:s.day,revenue:s.revenue,cost:s.cost,profit:s.profit,purchases:s.purchases,revenueComplete:s.revenueComplete,platform:s.costs.find(c=>c.category==='platform').amount},
                ...(value.total===undefined?{}:{total:value.total,offset:value.offset,hasMore:value.hasMore,entries:value.entries.map(e=>({day:e.day,kind:e.kind,amount:e.amount,refund:!!e.refundOf}))})};
        });
        assert.equal(transcript[0].summary.platform,-1000);
        const expected=new URL('./expected/ledger-reliability-transcript.json',import.meta.url);
        if(process.env.ZLM_RECORD_EXPECTED==='1') await writeFile(expected,JSON.stringify(transcript,null,2)+'\n');
        else assert.deepEqual(transcript,JSON.parse(await readFile(expected,'utf8')));
        await writeFile(join(ctx.profileContext.dir,'reliability-session.json'),JSON.stringify(events,null,2));
    } finally {ledger.close();}
}
