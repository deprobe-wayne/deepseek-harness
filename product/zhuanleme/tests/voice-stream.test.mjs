import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioStream, createVoiceDraft, pcmBase64 } from '../src/client/voice-stream.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('PCM keeps signed amplitude and frame ordering', () => {
    const bytes=Buffer.from(pcmBase64([new Float32Array([-1,0]),new Float32Array([1,.5])]),'base64');
    assert.deepEqual([0,2,4,6].map(i=>bytes.readInt16LE(i)),[-32768,0,32767,16384]);
});

test('serial audio upload drains the final short frame before finish and applies corrected text', async () => {
    const calls=[],texts=[];let release;
    const live=createAudioStream({id:'x',sampleRate:100,onText:text=>texts.push(text),onError:assert.fail,request:async body=>{
        calls.push(body);
        if(body.sequence===0)await new Promise(resolve=>{release=resolve;});
        return {text:body.action==='finish'?'今天收入100元。':`临时${body.sequence}`};
    }});
    live.push(new Float32Array(20).fill(.1));
    live.push(new Float32Array(20).fill(.2));
    live.push(new Float32Array(3).fill(.3));
    assert.equal(calls.length,1);
    const done=live.finish();release();assert.equal(await done,true);
    assert.deepEqual(calls.map(c=>[c.action,c.sequence]),[['chunk',0],['chunk',1],['finish',2]]);
    assert.equal(Buffer.from(calls[1].audio,'base64').length,46);
    assert.deepEqual(texts,['临时0','临时1','今天收入100元。']);
});

test('cancel ignores late recognition, drops pending audio and never submits finalization',async()=>{
    let release;const calls=[],texts=[];
    const live=createAudioStream({id:'x',sampleRate:100,onText:t=>texts.push(t),onError:assert.fail,request:async body=>{calls.push(body);return new Promise(resolve=>{release=resolve;});}});
    live.push(new Float32Array(20));live.push(new Float32Array(20));live.cancel();release({text:'不应出现'});await tick();
    assert.equal(await live.finish(),false);assert.deepEqual(texts,[]);assert.equal(calls.length,1);
});

test('network failure keeps previous text and refuses successful finish',async()=>{
    const errors=[];
    const live=createAudioStream({id:'x',sampleRate:100,onText:assert.fail,onError:e=>errors.push(e),request:async()=>{throw new Error('offline');}});
    live.push(new Float32Array(20));assert.equal(await live.finish(),false);assert.equal(errors[0].message,'offline');
});

test('draft replaces hypotheses, cancel restores existing text, and manual edits win',()=>{
    let draft='原有内容';const writer=createVoiceDraft(()=>draft,t=>{draft=t;});
    writer.update('今天收');writer.update('今天收入');assert.equal(draft,'原有内容\n今天收入');
    writer.cancel();assert.equal(draft,'原有内容');
    const second=createVoiceDraft(()=>draft,t=>{draft=t;});second.update('新文字');draft+='手动补充';
    assert.equal(second.update('修正结果'),false);second.cancel();assert.equal(draft,'原有内容\n新文字手动补充');
});
