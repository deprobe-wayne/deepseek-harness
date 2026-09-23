/* Runs on the audio rendering thread, with no main-thread sampling timer. */
class VoiceCapture extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(1024); this.offset = 0; this.stopped = false;
        this.port.onmessage = event => {
            if (event.data === 'stop') {
                this.stopped = true; this.flush(); this.port.postMessage({ flushed: true });
            }
        };
    }
    flush() {
        if (!this.offset) return;
        const frame = this.buffer.slice(0, this.offset);
        this.port.postMessage({ frame }, [frame.buffer]); this.offset = 0;
    }
    process(inputs) {
        const input = inputs[0]?.[0];
        if (!this.stopped && input) for (const sample of input) {
            this.buffer[this.offset++] = sample;
            if (this.offset === this.buffer.length) this.flush();
        }
        return !this.stopped;
    }
}
registerProcessor('zhuanleme-voice-capture', VoiceCapture);
