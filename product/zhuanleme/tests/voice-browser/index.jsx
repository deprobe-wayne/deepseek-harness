// Test-only fixture: feeds a public Mandarin sample through the real capture worklet and API.
import React,{useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {VoiceInput} from '../../src/client/voice-input.jsx';
import {zh} from '../../src/client/locales.js';
import css from '../../../../packages/client/ui-conversation/src/client/skeleton/InputBar.module.css';
import voiceCss from '../../src/client/zhuanleme.module.css';
let snapshot={draft:'原有草稿',phase:'plain'},listeners=new Set(),sent='';
const update=text=>{snapshot={...snapshot,draft:text};listeners.forEach(fn=>fn());};
const useInput=select=>select(useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>snapshot));
let denied=false;
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    if(denied)throw new DOMException('Denied for test','NotAllowedError');
    const ctx=new AudioContext({sampleRate:16000});await ctx.resume();
    const audio=await fetch('/voice-check/sample.wav').then(r=>r.arrayBuffer());
    const source=ctx.createBufferSource();source.buffer=await ctx.decodeAudioData(audio);
    const destination=ctx.createMediaStreamDestination();source.connect(destination);source.start(ctx.currentTime+1);
    for(const track of destination.stream.getTracks()){
        const stop=track.stop.bind(track);track.stop=()=>{stop();source.stop();void ctx.close();};
    }
    return destination.stream;
}});
function App(){
    const draft=useInput(s=>s.draft),[session,setSession]=useState(1),[sentText,setSentText]=useState('');
    const actions={setDraft:update,submit:()=>{sent=snapshot.draft;setSentText(sent);update('');}};
    return <main><h1>语音输入验证 · 公开样例音频</h1><p>使用真实本地流式识别，不访问麦克风，不发送对话消息。</p>
        <div data-composer-card className={css.card}>
            <div role="textbox" aria-label="草稿" contentEditable suppressContentEditableWarning style={{minHeight:90,padding:'12px 20px',whiteSpace:'pre-wrap',outline:'none'}} onInput={e=>update(e.currentTarget.textContent)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();actions.submit();}}}>{draft}</div>
            <div className={css.row}><div className={css.tools}><button aria-label="添加" className={css.add}>＋</button><span>帮我批准</span></div><div className={css.trailing}>
                <div data-slot="conversation.input.right" style={{display:'contents'}}><VoiceInput key={session} sessionId={String(session)} useInput={useInput} inputActions={actions} t={key=>zh[key]||key}/></div><span>中文模型</span><button className={css.primary} aria-label="发送草稿" onClick={actions.submit}>↑</button>
            </div></div>
        </div>
        <output aria-label="已发送内容">{sentText}</output>
        <nav><button onClick={()=>{setSession(n=>n+1);update('另一个对话');}}>切换测试对话</button><button onClick={()=>{denied=!denied;setSession(n=>n+1);}}>切换权限拒绝</button><button onClick={()=>{setSession(n=>n+1);update('原有草稿');setSentText('');}}>重置测试</button></nav>
    </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
