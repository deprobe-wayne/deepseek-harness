import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createReviewModel, reviewReference, turnReviewReferences } from './review-model.js';
import { shopForSession } from './model.js';
import css from './review-card.module.css';

const money = value => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
function Entry({ item, t }) {
    return <><dl className={css.facts}><div><dt>{t('date')}</dt><dd>{item.day} {item.time||''}</dd></div><div><dt>{t('kind')}</dt><dd>{t(item.kind)}{(item.category || item.channel) && ` · ${t(item.category || item.channel)}`}</dd></div><div><dt>{t('amount')}</dt><dd className={css.amount}>{money((item.refundOf?-1:1)*item.amount)}</dd></div></dl>{item.refundOf&&<p>{t('refundOf')}: {item.refundOf}</p>}{item.settlement&&<p>{t('settlement')}: {t('settlement_'+item.settlement)} {item.account||''}</p>}{item.note && <p className={css.note}>{item.note}</p>}</>;
}
function Rule({ item, t }) {
    return item ? <p>{t(item.method)} · {money(item.value)}{item.method === 'percent' ? '%' : ` ${t('money')}`}{item.base ? ` · ${t(item.base)}` : ''} · {t('effective')} {item.effective}</p> : <p>{t('missingBasis')}</p>;
}
function Review({ reference, t, changed, subscribeChanges }) {
    const model = useMemo(() => createReviewModel(reference, { changed, invalidMessage: t('reviewInvalid') }), [reference.shop, reference.type, reference.id, changed, t]);
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
    useEffect(() => {
        void model.load();
        const refresh = () => { if (!model.getSnapshot().busy) void model.load(); };
        const stop = subscribeChanges(shop => { if (shop === reference.shop) refresh(); });
        window.addEventListener('focus', refresh);
        return () => { stop(); window.removeEventListener('focus', refresh); model.dispose(); };
    }, [model, reference.shop, subscribeChanges]);
    const data = state.data, item = data?.item, pending = item && (reference.type === 'entry' ? item.status === 'draft' : item.status === 'pending');
    const status = !item ? 'reviewLoading' : reference.type === 'entry' ? ({ draft:'draft', posted:'posted', void:'reviewDiscarded' })[item.status] : ({ pending:'draft', applied:'reviewApplied', rejected:'reviewDiscarded' })[item.status];
    return <section className={css.card} aria-label={t('reviewTitle')} aria-busy={state.busy || state.loading} data-zlm-review={reference.id}>
        <header><strong>{t(reference.type === 'entry' ? 'reviewEntry' : item?.type === 'rules' ? 'reviewRules' : 'reviewChange')}</strong><span role="status" className={css.status}>{t(status)}</span></header>
        {data && <><p className={css.shop}>{data.shop.title}{data.demo ? ` · ${t('demo')}` : ''}</p>{reference.type === 'entry' ? <><Entry item={item} t={t}/>{pending && <p className={css.hint}>{t(item.mode==='transaction'?'transactionHint':`${item.kind}Hint`)}</p>}</> : item.type === 'entry' ? <div className={css.changes}><div><h4>{t('beforeChange')}</h4><Entry item={item.before} t={t}/></div><div><h4>{t('afterChange')}</h4>{item.action === 'void' ? <p>{t('voided')}</p> : <Entry item={item.entry} t={t}/>}</div></div> : item.rules.map(rule => <div className={css.rule} key={rule.category}><strong>{t(rule.category)}</strong><h4>{t('beforeChange')}</h4><Rule t={t} item={item.before.filter(r => r.category === rule.category && r.effective <= rule.effective).sort((a,b) => b.effective.localeCompare(a.effective) || b.seq-a.seq)[0]}/><h4>{t('afterChange')}</h4><Rule t={t} item={rule}/></div>)}</>}
        {state.error && <p role="alert" className={css.error}>{state.error} <span>{t('reviewRecheck')}</span></p>}
        {!data && state.loading && <p>{t('reviewLoading')}</p>}
        {pending && <><p className={css.hint}>{t('reviewHint')}</p><div className={css.actions}><button type="button" className={css.primary} disabled={state.busy || state.loading} onClick={() => void model.resolve('confirm')}>{t(state.busy ? 'saving' : reference.type === 'entry' ? 'confirm' : 'applyChange')}</button><button type="button" disabled={state.busy || state.loading} onClick={() => void model.resolve('reject')}>{t('reviewDiscard')}</button></div></>}
        {state.error && <button type="button" disabled={state.busy || state.loading} onClick={() => void model.load()}>{t('retry')}</button>}
    </section>;
}

/**
 * Uses the official atomic tool slot; legacy results resolve through their session workspace.
 * @param props - Official tool projection and injected review callbacks.
 * @returns A live confirmation card or non-actionable tool details.
 */
export function ReviewCard({ block, toolName, cwd, sessionId, useWorkspaces, t, changed, subscribeChanges }) {
    const shop = useWorkspaces(s => shopForSession(s.items, sessionId, cwd)?.workspaceId);
    const reference = reviewReference(toolName, block, shop);
    if (reference) return <Review key={`${reference.shop}/${reference.id}`} reference={reference} t={t} changed={changed} subscribeChanges={subscribeChanges}/>;
    const settled = 'kind' in block;
    const output = settled ? block.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') : '';
    return <details className={css.fallback}><summary>{t(toolName === 'zhuanleme_draft' ? 'reviewEntry' : toolName === 'zhuanleme_rules' ? 'reviewRules' : 'reviewChange')} · {t(!settled ? 'reviewGenerating' : block.isError ? 'failed' : 'reviewUnavailable')}</summary>{output && <pre>{output}</pre>}</details>;
}

/**
 * Keep confirmation visible when the host collapses a completed turn's tool calls.
 * @param props - Official turn, chat/workspace hooks and injected review callbacks.
 * @returns The current turn's deduplicated cards, or null when no review was generated.
 */
export function TurnReviews({ turn, sessionId, useWorkspaces, useChat, t, changed, subscribeChanges }) {
    const shop = useWorkspaces(s => shopForSession(s.items, sessionId)?.workspaceId);
    const snapshot = useChat(s => s);
    const references = turnReviewReferences(snapshot, turn.turn, shop);
    if (!references.length) return null;
    return <div data-zlm-turn-reviews={turn.turn}>{references.map(reference => <Review key={`${reference.shop}/${reference.id}`} reference={reference} t={t} changed={changed} subscribeChanges={subscribeChanges}/>)}</div>;
}
