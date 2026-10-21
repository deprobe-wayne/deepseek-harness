import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createAssistantModeModel } from './assistant-mode.js';
import css from './assistant-mode.module.css';

/** Conversation-level task switch; the host applies the selected policy to subsequent turns. */
export function AssistantModes({ shop, sessionId, running, hero, t, onHome }) {
    const model = useMemo(() => createAssistantModeModel({ shop, sessionId }), [shop, sessionId]);
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
    useEffect(() => {
        void model.load();
        const refresh = () => { void model.load(); };
        window.addEventListener('focus', refresh);
        return () => { window.removeEventListener('focus', refresh); model.dispose(); };
    }, [model]);
    return <div className={css.surface}>
        <header className={css.header}>
            <nav className={css.modes} aria-label={t('assistantModes')}>
                {['record', 'analysis'].map(mode => <button key={mode} type="button" aria-pressed={state.mode === mode} disabled={running || state.busy || state.loading} onClick={() => void model.select(mode)}>{t(`${mode}Mode`)}</button>)}
            </nav>
            {state.busy && <span className={css.progress} role="status">{t('modeSaving')}</span>}
            {onHome && <button className={css.home} type="button" onClick={onHome}>{t('home')}</button>}
        </header>
        {state.error && <div className={css.error} role="alert">{t('modeFailed')}<button type="button" onClick={() => void model.load()}>{t('retry')}</button></div>}
        {hero && state.mode && <div className={css.welcome}><h2>{t(`${state.mode}Title`)}</h2><p>{t(`${state.mode}Hint`)}</p></div>}
    </div>;
}
