import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createShopState} from '../src/shop-state.mjs';
import {createVoiceBridge} from '../src/voice.mjs';
test('shop deletion survives restart, blocks running shops and restores the same identity',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'shops-test-'));
    const registry={get:id=>id==='a'?{id,sessionIds:['session']}:undefined};let running=true,state;
    try{
        state=createShopState(join(dir,'shops.db'),registry,()=>running);
        assert.throws(()=>state.handle({op:'shop-delete',shop:'a'}),/运行/);
        running=false;assert.deepEqual(state.handle({op:'shop-delete',shop:'a'}),{deleted:['a']});state.close();
        state=createShopState(join(dir,'shops.db'),registry);
        assert.equal(state.deleted('a'),true);assert.throws(()=>state.handle({op:'shop-delete',shop:'missing'}),/不存在/);
        assert.deepEqual(state.handle({op:'shop-restore',shop:'a'}),{deleted:[]});assert.equal(registry.get('a').sessionIds[0],'session');
    }finally{state?.close();await rm(dir,{recursive:true,force:true});}
});
test('voice bridge checks configuration, calls the plugin pipeline and removes audio on success and failure',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'voice-test-'));let ready=false,fail=false,transcribed=0;
    const tools={get:()=>({}),async execute(call){
        assert.ok(call.signal);assert.match(call.callId,/^voice-/);
        if(call.name==='voice_health')return {isError:false,value:{checks:[{name:'ASR 引擎',ok:true,detail:'custom'},{name:'ASR 接口地址',ok:true},{name:'ASR 密钥',ok:ready}]}};
        assert.equal(call.name,'voice_stt');transcribed++;assert.equal((await readFile(call.arguments.audio)).toString(),'test-audio');
        return fail?{isError:true}:{isError:false,value:{text:'咖啡豆 860 元'}};
    }};
    try{
        const bridge=createVoiceBridge(tools,dir),signal=new AbortController().signal;
        const input={op:'voice-transcribe',audio:Buffer.from('test-audio').toString('base64'),mime:'audio/webm;codecs=opus'};
        assert.equal((await bridge.handle({op:'voice-status'},signal)).ready,false);
        await assert.rejects(bridge.handle(input,signal),/尚未配置/);assert.equal(transcribed,0);
        ready=true;assert.deepEqual(await bridge.handle(input,signal),{text:'咖啡豆 860 元'});assert.deepEqual(await readdir(dir),[]);
        fail=true;await assert.rejects(bridge.handle(input,signal),/调用失败/);assert.deepEqual(await readdir(dir),[]);
        await assert.rejects(bridge.handle({...input,mime:'text/plain'},signal),/格式/);
    }finally{await rm(dir,{recursive:true,force:true});}
});
