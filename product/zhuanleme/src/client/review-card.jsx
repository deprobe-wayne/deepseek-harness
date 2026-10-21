import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createReviewModel, reviewReference, turnReviewReferences, groupTurnReviews } from './review-model.js';
import { shopForSession } from './model.js';
import css from './review-card.module.css';
import { entryDescription } from '../entry-description.mjs';

const money = value => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
function Entry({ item, t, compact = false }) {
    const description = entryDescription(item);
    return <div className={css.entry}>
        <div className={css.entryMain}>
            <strong className={css.item}>{description.note || t(item.kind)}</strong>
            <strong className={css.amount}>{item.refundOf ? '−' : ''}¥{money(item.amount)}</strong>
        </div>
        {!compact && <div className={css.entryMeta}><span>{item.day}{item.time ? ` ${item.time}` : ''}</span><span>{t(item.kind === 'purchase' ? 'reviewPurchaseLabel' : item.kind)}{(item.category || item.channel) && ` · ${t(item.category || item.channel)}`}</span>{item.mode === 'summary' && <span>{t('summary')}</span>}{item.settlement && item.settlement !== 'unknown' && <span>{t('settlement_'+item.settlement)}</span>}{item.account && <span>{item.account}</span>}{item.refundOf && <span>{t('refund')}</span>}</div>}
        {item.costCoverage&&<p className={css.entryMeta}>{t('coverage_'+item.costCoverage)}</p>}{item.costFrom&&<p className={css.entryMeta}>{t('costTiming')}: {item.costFrom} — {item.costTo}</p>}{item.revenueBasis==='net'&&<p className={css.entryMeta}>{t('basis_net')} · {t('platformFee')}: ¥{money(item.platformFee)}</p>}
        {description.details && (compact ? <p className={css.itemDetails}>{description.details}</p> : <details className={css.refund}><summary>{t('entryDetails')}</summary>{description.details}</details>)}
        {item.refundOf && <details className={css.refund}><summary>{t('refundOf')}</summary>{item.refundOf}</details>}
    </div>;
}
function Rule({ item, t }) {
    return item ? <p>{t(item.method)} · {item.method === 'percent' ? `${(item.value/100).toFixed(2)}%` : `¥${money(item.value)}`}{item.base ? ` · ${t(item.base)}` : ''} · {t('effective')} {item.effective}</p> : <p>{t('missingBasis')}</p>;
}
function Review({ reference, t, changed, subscribeChanges, openLedger, running = false }) {
    const model = useMemo(() => createReviewModel(reference, { changed, invalidMessage: t('reviewInvalid') }), [reference.shop, reference.type, reference.id, reference.ids?.join('/'), changed, t]);
    const [navigationError, setNavigationError] = useState('');
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
    useEffect(() => {
        void model.load();
        const refresh = () => { if (!model.getSnapshot().busy) void model.load(); };
        const stop = subscribeChanges(shop => { if (shop === reference.shop) refresh(); });
        window.addEventListener('focus', refresh);
        return () => { stop(); window.removeEventListener('focus', refresh); model.dispose(); };
    }, [model, reference.shop, subscribeChanges]);
    const data = state.data, item = data?.item, grouped = reference.type === 'entries';
    const entries = grouped ? data?.items || [] : reference.type === 'entry' && item ? [item] : [];
    const pending = grouped ? entries.some(row => row.status === 'draft') : item && (reference.type === 'entry' ? item.status === 'draft' : item.status === 'pending');
    const posted = entries.filter(row => row.status === 'posted');
    const status = !data ? 'reviewLoading' : grouped ? pending ? 'draft' : posted.length === entries.length ? 'posted' : posted.length ? 'reviewPartial' : 'reviewDiscarded' : reference.type === 'entry' ? ({ draft:'draft', posted:'posted', void:'reviewDiscarded' })[item.status] : ({ pending:'draft', applied:'reviewApplied', rejected:'reviewDiscarded' })[item.status];
    const days = [...new Set(entries.map(row => row.day))];
    const commonKind = entries.length && entries.every(row => row.kind === entries[0].kind) ? entries[0].kind : null;
    const showLedger = () => { setNavigationError(''); void openLedger(reference.shop, posted).catch(error => setNavigationError(error.message)); };
    return <section className={css.card} aria-label={t('reviewTitle')} aria-busy={state.busy || state.loading} data-zlm-review={reference.id || reference.ids[0]} data-zlm-review-group={grouped ? reference.ids.length : undefined}>
        <header><span className={css.shop}>{data ? data.shop.title : t('reviewEntry')}{data?.demo ? ` · ${t('demo')}` : ''}</span><span role="status" className={css.status} data-status={status === 'posted' ? 'posted' : item?.status}>{t(status)}</span></header>
        {data && <>{grouped ? <><div className={css.entries}>{entries.map(row => <div key={row.id}><Entry item={row} t={t} compact={days.length === 1 && !!commonKind}/>{row.status === 'void' && <span className={css.status}>{t('reviewDiscarded')}</span>}</div>)}</div><div className={css.groupSummary}><span>{entries.length} {t('reviewItems')} · {days.join(' / ')}{commonKind && ` · ${t(commonKind)}`}</span><strong>{t('total')} ¥{money(entries.filter(row => row.status !== 'void').reduce((total, row) => total + (row.refundOf ? -1 : 1) * row.amount, 0))}</strong></div></> : reference.type === 'entry' ? <Entry item={item} t={t}/> : <><h3>{t(item.type === 'rules' ? 'reviewRules' : 'reviewChange')}</h3>{item.type === 'entry' ? <div className={css.changes}><div><h4>{t('beforeChange')}</h4><Entry item={item.before} t={t}/></div><div><h4>{t('afterChange')}</h4>{item.action === 'void' ? <p>{t('voided')}</p> : <Entry item={item.entry} t={t}/>}</div></div> : item.rules.map(rule => <div className={css.rule} key={rule.category}><strong>{t(rule.category)}</strong><div className={css.ruleDiff}><div><h4>{t('beforeChange')}</h4><Rule t={t} item={item.before.filter(r => r.category === rule.category && r.effective <= rule.effective).sort((a,b) => b.effective.localeCompare(a.effective) || b.seq-a.seq)[0]}/></div><div><h4>{t('afterChange')}</h4><Rule t={t} item={rule}/></div></div></div>)}</>}</>}
        {state.error && <p role="alert" className={css.error}>{state.error} <span>{t('reviewRecheck')}</span></p>}
        {!data && state.loading && <p>{t('reviewLoading')}</p>}
        {pending && <div className={css.actions}><button type="button" disabled={state.busy || state.loading || running} onClick={() => void model.resolve('reject')}>{t(grouped ? 'reviewDiscardAll' : 'reviewDiscard')}</button><button type="button" className={css.primary} disabled={state.busy || state.loading || running} onClick={() => void model.resolve('confirm')}>{t(state.busy ? 'saving' : running ? 'reviewGenerating' : grouped ? 'reviewConfirmAll' : reference.type === 'entry' ? 'confirm' : 'applyChange')}</button></div>}
        {posted.length > 0 && <div className={css.actions}><button type="button" onClick={showLedger}>{t('reviewOpenLedger')}</button></div>}
        {navigationError && <p role="alert" className={css.error}>{navigationError}</p>}
        {state.error && <button type="button" disabled={state.busy || state.loading} onClick={() => void model.load()}>{t('retry')}</button>}
    </section>;
}

/**
 * Shows tool status while confirmation stays in the turn's deduplicated review cards.
 * @param props - Official tool projection and injected review callbacks.
 * @returns Non-actionable tool status or details.
 */
export function ReviewCard({ block, toolName, cwd, sessionId, useWorkspaces, t }) {
    const shop = useWorkspaces(s => shopForSession(s.items, sessionId, cwd)?.workspaceId);
    const reference = reviewReference(toolName, block, shop);
    if (reference) return <p className={css.fallback}>{t(toolName === 'zhuanleme_draft' ? 'reviewEntry' : 'reviewChange')} · {t('reviewInTurn')}</p>;
    const settled = 'kind' in block;
    const output = settled ? block.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') : '';
    return <details className={css.fallback}><summary>{t(toolName === 'zhuanleme_draft' ? 'reviewEntry' : toolName === 'zhuanleme_rules' ? 'reviewRules' : 'reviewChange')} · {t(!settled ? 'reviewGenerating' : block.isError ? 'failed' : 'reviewUnavailable')}</summary>{output && <pre>{output}</pre>}</details>;
}

/**
 * Keep confirmation visible when the host collapses a completed turn's tool calls.
 * @param props - Official turn, chat/workspace hooks and injected review callbacks.
 * @returns The current turn's deduplicated cards, or null when no review was generated.
 */
export function TurnReviews({ turn, sessionId, useWorkspaces, useChat, useSession, t, changed, subscribeChanges, openLedger }) {
    const shop = useWorkspaces(s => shopForSession(s.items, sessionId)?.workspaceId);
    const snapshot = useChat(s => s);
    const running = useSession(s => s.running);
    const references = turnReviewReferences(snapshot, turn.turn, shop);
    if (!references.length) return null;
    return <div data-zlm-turn-reviews={turn.turn}>{groupTurnReviews(references).map(reference => <Review key={`${reference.shop}/${reference.id || reference.ids.join('/')}`} reference={reference} t={t} changed={changed} subscribeChanges={subscribeChanges} openLedger={openLedger} running={running}/>)}</div>;
}
