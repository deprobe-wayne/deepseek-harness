import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Reuse the installed voice plugin through the normal tool execution pipeline. */
export function createVoiceBridge(tools, dir) {
    const run = async (name, args, signal) => {
        if (!tools.get?.(name)) throw new Error('语音插件未启用');
        const result = await tools.execute({ name, arguments: args, callId: `voice-${randomUUID()}`, signal });
        if (result.isError) throw new Error('语音插件调用失败，请检查插件配置与权限');
        return result.value;
    };
    const status = async signal => {
        if (!tools.get?.('voice_stt') || !tools.get?.('voice_health')) return { ready:false, reason:'语音插件未启用' };
        const health = await run('voice_health', {}, signal);
        const checks = health.checks?.filter(r => r.name.startsWith('ASR')) || [];
        const ready = checks.length >= 3 && checks.every(r => r.ok);
        return { ready, reason:ready?'':'语音识别尚未配置 ASR 密钥或接口，请在 dsh-voice 配置后重启', engine:checks.find(r=>r.name==='ASR 引擎')?.detail };
    };
    return { async handle(input, signal) {
        if (input.op === 'voice-status') return status(signal);
        if (input.op === 'voice-stream') {
            if (!['start','chunk','finish','cancel'].includes(input.action)) throw new Error('无效的录音操作');
            if (input.audio !== undefined && (typeof input.audio !== 'string' || input.audio.length > 520000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio))) throw new Error('音频片段无效或过大');
            if (input.action !== 'start' && (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id))) throw new Error('录音标识无效');
            if (['chunk','finish'].includes(input.action) && (!Number.isSafeInteger(input.sequence) || input.sequence < 0)) throw new Error('音频顺序无效');
            return run('voice_stream', { action:input.action, ...(input.id!==undefined?{id:input.id}:{}), ...(input.audio!==undefined?{audio:input.audio}:{}), ...(input.sampleRate!==undefined?{sampleRate:input.sampleRate}:{}), ...(input.sequence!==undefined?{sequence:input.sequence}:{}) }, signal);
        }
        if (input.op !== 'voice-transcribe') return null;
        const info = await status(signal);
        if (!info.ready) throw new Error(info.reason);
        const extensions = { 'audio/webm':'webm', 'audio/mp4':'m4a', 'audio/ogg':'ogg', 'audio/wav':'wav' };
        const ext = extensions[String(input.mime).split(';')[0]];
        if (!ext || typeof input.audio !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio) || input.audio.length > 14000000) throw new Error('录音格式无效或超过 10MB');
        const audio = Buffer.from(input.audio,'base64');
        if (!audio.length || audio.length > 10*1024*1024) throw new Error('录音为空或超过 10MB');
        const folder = await mkdtemp(join(dir,'voice-'));
        try {
            const path = join(folder,`recording.${ext}`);
            await writeFile(path,audio,{mode:0o600});
            const value = await run('voice_stt',{audio:path,language:'zh'},signal);
            if (typeof value?.text !== 'string' || !value.text.trim()) throw new Error('没有识别到语音，请重试');
            return { text:value.text.trim() };
        } finally { await rm(folder,{recursive:true,force:true}); }
    } };
}
