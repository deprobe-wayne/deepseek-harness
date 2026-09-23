import React, { useEffect, useRef, useState } from 'react';
import { api } from './model.js';
import { createAudioStream, createVoiceDraft } from './voice-stream.mjs';
import css from './zhuanleme.module.css';

function Glyph({ name }) {
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'mic' ? <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/></> : name === 'cancel' ? <path d="m6 6 12 12M6 18 18 6"/> : name === 'stop' ? <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/> : <path d="M12 21V3m-8 8 8-8 8 8"/>}</svg>;
}

/** One microphone, one session-owned recording. The editor receives actual ASR updates. */
export function VoiceInput({ sessionId, useInput, inputActions, t }) {
    const draft = useInput(s => s.draft), inputPhase = useInput(s => s.phase);
    const latest = useRef(draft); latest.current = draft;
    const [phase, setPhase] = useState('idle'), [error, setError] = useState('');
    const [levels, setLevels] = useState(() => Array(80).fill(0));
    const current = useRef(null), root = useRef(null), mic = useRef(null);
    const active = phase !== 'idle';
    const write = text => { latest.current = text; inputActions.setDraft(text); };
    const release = run => {
        clearTimeout(run.limit); clearTimeout(run.flushTimer); run.flushed?.();
        if (run.processor) { run.processor.port.onmessage = null; run.processor.disconnect(); }
        run.source?.disconnect(); run.gain?.disconnect();
        run.media?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        if (run.context?.state !== 'closed') void run.context?.close().catch(() => {});
    };
    const discard = run => {
        run.abort.abort(); run.live?.cancel(); release(run);
        if (run.id) void api({ op:'voice-stream', action:'cancel', id:run.id }, AbortSignal.timeout(2000)).catch(() => {});
    };
    const focusMic = () => requestAnimationFrame(() => mic.current?.focus());
    const cancel = (revert = true, focus = true) => {
        const run = current.current;
        if (!run) return;
        current.current = null; discard(run);
        if (revert) run.writer.cancel();
        setPhase('idle'); if (focus) focusMic();
    };
    useEffect(() => {
        setPhase('idle'); setError('');
        return () => {
            const run = current.current; current.current = null;
            if (run) discard(run);
        };
    }, [sessionId]);
    const finish = async send => {
        const run = current.current;
        if (!run || run.finishing || !run.live) return;
        run.finishing = true; setPhase('finishing'); clearTimeout(run.limit);
        // Flush the audio thread before draining the network queue, including its last short frame.
        await new Promise(resolve => {
            run.flushed = resolve;
            run.flushTimer = setTimeout(resolve, 500);
            run.processor.port.postMessage('stop');
        });
        release(run);
        if (current.current !== run) return;
        const ok = await run.live.finish();
        if (current.current !== run) return;
        current.current = null; setPhase('idle');
        if (ok && send && latest.current.trim()) inputActions.submit();
        else focusMic();
    };
    // Keyboard submit follows the same final-audio flush as the send arrow.
    useEffect(() => {
        if (!active) return;
        const card = root.current?.closest('[data-composer-card]');
        const keydown = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
            else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.target.closest('[contenteditable]')) {
                event.preventDefault(); event.stopPropagation(); void finish(true);
            }
        };
        card?.addEventListener('keydown', keydown, true);
        return () => card?.removeEventListener('keydown', keydown, true);
    }, [active]);
    const start = async () => {
        if (current.current) return;
        const run = { abort:new AbortController(), writer:createVoiceDraft(() => latest.current, write) };
        current.current = run; setPhase('checking'); setError(''); setLevels(Array(80).fill(0));
        requestAnimationFrame(() => root.current?.querySelector('[data-voice-cancel]')?.focus());
        const fail = error => {
            if (current.current !== run) return;
            cancel(false); setError(error.name === 'NotAllowedError' ? t('voicePermission') : error.message === 'VOICE_SLOW' ? t('voiceSlow') : error.message || t('voiceFailed'));
        };
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!navigator.mediaDevices?.getUserMedia || !AudioContext || !window.AudioWorkletNode) throw new Error(t('voiceUnsupported'));
            // Resume in the click gesture; permission never starts capture automatically.
            run.context = new AudioContext({ sampleRate:16000 }); await run.context.resume();
            const media = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:1, echoCancellation:true, noiseSuppression:true } });
            if (current.current !== run) { media.getTracks().forEach(track => track.stop()); return; }
            run.media = media;
            media.getAudioTracks().forEach(track => { track.onended = () => fail(new Error(t('voiceDisconnected'))); });
            await run.context.audioWorklet.addModule('/zhuanleme/voice-capture.js');
            if (current.current !== run) return;
            const request = body => api({ op:'voice-stream', ...body }, AbortSignal.any([run.abort.signal, AbortSignal.timeout(15000)]));
            const result = await request({ action:'start', sampleRate:run.context.sampleRate });
            run.id = result.id;
            if (current.current !== run) { discard(run); return; }
            run.live = createAudioStream({
                request, id:run.id, sampleRate:run.context.sampleRate,
                onText: text => {
                    if (current.current === run && !run.writer.update(text)) cancel(false, false);
                },
                onError:fail,
            });
            run.source = run.context.createMediaStreamSource(media);
            run.processor = new AudioWorkletNode(run.context, 'zhuanleme-voice-capture');
            run.gain = run.context.createGain(); run.gain.gain.value = 0;
            run.processor.onprocessorerror = () => fail(new Error(t('voiceFailed')));
            run.processor.port.onmessage = event => {
                if (current.current !== run) return;
                if (event.data.flushed) { run.flushed?.(); return; }
                const frame = event.data.frame;
                run.live.push(frame);
                const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);
                setLevels(old => [...old.slice(1), Math.min(1, rms * 12)]);
            };
            run.source.connect(run.processor); run.processor.connect(run.gain); run.gain.connect(run.context.destination);
            run.limit = setTimeout(() => { void finish(false); }, 120000);
            setPhase('recording');
        } catch (error) { fail(error); }
    };
    return <span ref={root} className={css.voiceControl} data-active={active}>
        {!active ? <button ref={mic} type="button" aria-label={t('voiceStart')} title={t('voiceStart')} disabled={inputPhase !== 'plain'} onClick={() => { void start(); }}><Glyph name="mic"/></button> :
            <span className={css.voiceBar} role="group" aria-label={t('voiceRecording')} aria-busy={phase !== 'recording'}>
                <button type="button" data-voice-cancel aria-label={t('voiceCancel')} title={t('voiceCancel')} onClick={() => cancel()}><Glyph name="cancel"/></button>
                <span className={css.voiceWave} aria-hidden="true">{levels.map((level, i) => <i key={i} style={{ height:`${3 + (i >= 64 ? level * 25 : 0)}px`, opacity:i >= 64 && level > 0.07 ? 0.65 : 0.25 }}/>)}</span>
                {phase !== 'recording' && <span className={css.voiceProgress}>{t(phase === 'checking' ? 'voicePreparing' : 'voiceWorking')}</span>}
                <span className={css.voiceAnnouncement} role="status">{t(phase === 'checking' ? 'voicePreparing' : phase === 'finishing' ? 'voiceWorking' : 'voiceRecording')}</span>
                <button type="button" aria-label={t('voiceStop')} title={t('voiceStop')} disabled={phase !== 'recording'} onClick={() => { void finish(false); }}><Glyph name="stop"/></button>
                <button type="button" className={css.voiceSend} aria-label={t('voiceSend')} title={t('voiceSend')} disabled={phase !== 'recording'} onClick={() => { void finish(true); }}><Glyph name="send"/></button>
            </span>}
        {error && <span className={css.voiceError} role="alert">{error}<button type="button" aria-label={t('close')} onClick={() => setError('')}><Glyph name="cancel"/></button></span>}
    </span>;
}
