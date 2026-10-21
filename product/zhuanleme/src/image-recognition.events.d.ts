import type { ContextFormed, LlmCallConfig, Message } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session/types';

/** Product-owned auxiliary records, separate from the main Agent's request/header. */
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        'zhuanleme/image-request': { messageId: string; config: LlmCallConfig; system: string; messages: Message[] };
        'zhuanleme/image-result': { messageId: string; requestSeq?: number; status: 'ok' | 'error'; result?: unknown; error?: string };
    }
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'zhuanleme-image-recognition': { kind: 'zhuanleme-image-recognition' } & Partial<ContextFormed>;
    }
}
