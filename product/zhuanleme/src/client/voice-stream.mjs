export function pcmBase64(frames) {
    const count = frames.reduce((sum, frame) => sum + frame.length, 0);
    const bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
    let offset = 0;
    for (const frame of frames) for (const value of frame) {
        const sample = Math.max(-1, Math.min(1, value));
        view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); offset += 2;
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}

/** Ordered, once-only PCM delivery. Finish drains all captured audio before committing. */
export function createAudioStream({ request, id, sampleRate, onText, onError }) {
    let frames = [], samples = 0, sequence = 0, running = null, closing = false, cancelled = false;
    const fail = error => { if (!cancelled) { cancelled = true; frames = []; samples = 0; onError(error); } };
    const pump = () => {
        if (running || cancelled) return running;
        running = (async () => {
            while (!cancelled && samples && (closing || samples >= sampleRate * 0.2)) {
                const audio = pcmBase64(frames);
                frames = []; samples = 0;
                const result = await request({ action: 'chunk', id, sequence: sequence++, audio });
                if (!cancelled) onText(result.text);
            }
        })().catch(fail).finally(() => { running = null; });
        return running;
    };
    return {
        push(frame) {
            if (closing || cancelled) return;
            frames.push(frame); samples += frame.length;
            if (samples > sampleRate * 3) { fail(new Error('VOICE_SLOW')); return; }
            if (samples >= sampleRate * 0.2) void pump();
        },
        async finish() {
            closing = true;
            while (!cancelled && (running || samples)) { if (running) await running; else await pump(); }
            if (cancelled) return false;
            try {
                const result = await request({ action: 'finish', id, sequence: sequence++ });
                if (cancelled) return false;
                onText(result.text); return !cancelled;
            } catch (error) { fail(error); return false; }
        },
        cancel() { cancelled = true; frames = []; samples = 0; },
    };
}

/** Never overwrite a manual edit or a draft that has already been sent. */
export function createVoiceDraft(read, write) {
    const original = read(), prefix = original + (original && !/\s$/.test(original) ? '\n' : '');
    let last = original;
    return {
        update(text) {
            if (read() !== last) return false;
            last = text ? prefix + text : original; write(last); return true;
        },
        cancel() { if (read() === last) write(original); },
    };
}
