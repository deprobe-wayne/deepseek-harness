import { VoiceInput } from './voice-input.jsx';
import { createShopActions } from './shop-model.js';
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { api, createModel, createNavigation, shopForSession } from './model.js';
import { zh, en } from './locales.js';
import { ReviewCard, TurnReviews } from './review-card.jsx';
import { LedgerGrid } from './ledger-grid.jsx';
import { ConversationList } from './conversation-actions.jsx';
import { createConversationActions } from './conversation-model.js';
import { conversationZh, conversationEn } from './conversation-locales.js';
import css from './zhuanleme.module.css';
const NS = 'zhuanleme';
const categories = ['materials', 'labor', 'rent', 'utilities', 'platform', 'other'];
const channels = ['store', 'meituan', 'douyin', 'other'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const money = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
const Icon = ({ name = 'plus', size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'plus' ? <path d="M12 5v14M5 12h14"/> : name === 'chart' ? <path d="M4 20V12h4v8m3 0V5h4v15m3 0v-9h4v9M2 20h21"/> : name === 'table' ? <path d="M3 4h18v16H3zM3 9h18M3 14h18M9 4v16"/> : name === 'shop' ? <><path d="M4 10v10h16V10M3 10l2-6h14l2 6M9 20v-6h6v6"/><path d="M3 10c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0"/></> : <path d="M5 6h14v10H9l-4 4z"/>}</svg>;
function BrandMark() { return <img className={css.logo} src="/zhuanleme/logo.png" alt=""/>; }
function BrandName({ t }) { return <strong className={css.brand}>{t('brand')}</strong>; }
function ShopDeleteConfirm({ shop, onDelete, onClose, t }) {
    const dialog=useRef(null),[pending,setPending]=useState(false),[error,setError]=useState('');
    useEffect(()=>{const node=dialog.current;node.showModal();return()=>node.close();},[]);
    return <dialog ref={dialog} className={css.shopDeleteDialog} aria-label={t('confirmDeleteShop')} onCancel={e=>{e.preventDefault();if(!pending)onClose();}}>
        <h3>{t('confirmDeleteShop')}</h3><p>{shop.title}</p>
        {error&&<p role="alert" className={css.error}>{error}</p>}
        <div className={css.shopDeleteActions}><button autoFocus disabled={pending} onClick={onClose}>{t('cancel')}</button><button disabled={pending} className={css.shopDeleteCommit} onClick={async()=>{setPending(true);setError('');try{await onDelete(shop.id);onClose();}catch(e){setError(e.message);setPending(false);}}}>{t(pending?'shopDeleting':'deleteShop')}</button></div>
    </dialog>;
}
function Shops({ useShopState, removeShop, restoreShop, loadShops, pinSession, useConversationState, reloadConversations, archiveSession, unarchiveSession, deleteSession, restoreSession, useWorkspaces, useSessions, useSessionStatus, useProductNavigation, selectPage, openDemo, openShop, openSession, newChat, createShop, t, wide = true }) {
    const shopState=useShopState(s=>s),[deleteTarget,setDeleteTarget]=useState(null);
    useEffect(()=>{void loadShops().catch(e=>setError(e.message));},[loadShops]);
    const workspaces = useWorkspaces(s => s.items.map(w => ({ ...w, id: w.workspaceId }))), sessions = useSessions(s => s.byId);
    const nav = useProductNavigation(s => s);
    const conversationState = useConversationState(s => s), archived = useWorkspaces(s => s.archivedSessionIds), statuses = useSessionStatus(s => s);
    useEffect(() => { void reloadConversations(); const refresh = () => void reloadConversations(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [reloadConversations]);
    const [adding, setAdding] = useState(false), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const run = async () => { setBusy(true); setError(''); try {
        await createShop(name);
        setName('');
        setAdding(false);
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } };
    return <section className={css.shops}>
        <div className={css.shopHeading}>{wide && <span>{t('shops')}</span>}<button className={css.iconButton} aria-label={t('addShop')} onClick={() => setAdding(!adding)}><Icon /></button></div>
        {adding && <form className={css.shopForm} onSubmit={e => { e.preventDefault(); void run(); }}><label>{t('shopName')}<input autoFocus required maxLength={60} value={name} placeholder={t('shopPlaceholder')} onChange={e => setName(e.target.value)}/></label><button disabled={busy} className={css.primary}>{t(busy ? 'shopCreating' : 'create')}</button><button type="button" onClick={() => setAdding(false)}>{t('cancel')}</button></form>}
        {error && <p role="alert" className={css.error}>{error}</p>}
        {workspaces.filter(w=>!shopState.deleted.includes(w.id)).map(w => <details open className={css.shopGroup} key={w.id}>
            <summary className={css.shopButton} title={w.path} aria-label={w.title}><Icon name="shop"/>{wide && <span>{w.title}</span>}<button className={css.shopDelete} aria-label={`${t('deleteShop')} · ${w.title}`} title={t('deleteShop')} onClick={e=>{e.preventDefault();e.stopPropagation();setDeleteTarget(w);}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg></button></summary>
            <nav className={css.shopChildren} aria-label={w.title}>
                {['overview','entries'].map(view => <button className={css.shopNavButton} key={view} title={t(view)} aria-label={`${w.title} · ${t(view)}`} aria-current={nav.shopId === w.id && nav.view === view ? 'page' : undefined} onClick={() => { selectPage(w.id, view).catch(e => setError(e.message)); }}><Icon name={view === 'overview' ? 'chart' : 'table'} size={15}/>{wide && <span>{t(view)}</span>}</button>)}
                {wide ? <ConversationList navigationClassName={css.shopNavButton} active={nav.shopId === w.id && nav.view === 'chat'} newChat={newChat} pinSession={pinSession} workspace={w} sessions={sessions} archivedSessionIds={archived} state={conversationState} statuses={statuses} t={t} openSession={openSession} archiveSession={archiveSession} unarchiveSession={unarchiveSession} deleteSession={deleteSession} restoreSession={restoreSession} reload={reloadConversations}/>
                    : <button className={css.shopNavButton} title={t('conversations')} aria-label={`${w.title} · ${t('conversations')}`} aria-current={nav.shopId === w.id && nav.view === 'chat' ? 'page' : undefined} onClick={() => selectPage(w.id, 'chat').catch(e => setError(e.message))}><Icon name="chat" size={15}/></button>}
            </nav>
        </details>)}
        {deleteTarget&&<ShopDeleteConfirm shop={deleteTarget} onDelete={removeShop} onClose={()=>setDeleteTarget(null)} t={t}/>}
    </section>;
}
const shiftDay = (day, count) => new Date(Date.parse(day)+count*86400000).toISOString().slice(0,10);
function Trend({ rows: seed, shop, onDate, day, t }) {
    const [rows,setRows]=useState(seed),[error,setError]=useState(''),[loading,setLoading]=useState(false);
    const [plotWidth,setPlotWidth]=useState(490);
    const drag=useRef(null),suppressClick=useRef(false),resizePosition=useRef(null);
    const viewport=useRef(null), anchor=useRef(day), pending=useRef(false), restore=useRef(null), ready=useRef(false), abort=useRef(null);
    const fetchRange=async(from,to,older=false)=>{
        if(pending.current)return;
        pending.current=true;setLoading(true);setError('');
        const controller=new AbortController();abort.current=controller;
        try{
            const result=await api({op:'period',shop,from,to,limit:1},controller.signal);
            if(controller.signal.aborted)return;
            restore.current=older?{width:viewport.current.scrollWidth,left:viewport.current.scrollLeft}: {initial:true};
            setRows(previous=>older?[...result.days,...previous]:result.days);
        }catch(e){if(e.name!=='AbortError')setError(e.message);}
        finally{if(!controller.signal.aborted){pending.current=false;setLoading(false);}}
    };
    useEffect(()=>{void fetchRange(shiftDay(anchor.current,-29),anchor.current);return()=>abort.current?.abort();},[shop]);
    useLayoutEffect(()=>{const node=viewport.current,position=restore.current;if(!node||!position)return;node.scrollLeft=position.initial?node.scrollWidth:position.left+node.scrollWidth-position.width;restore.current=null;ready.current=true;},[rows]);
    useEffect(()=>{const updates=new Map(seed.map(r=>[r.day,r]));setRows(previous=>{let changed=false;const next=previous.map(r=>{const update=updates.get(r.day);if(update&&['revenue','cost','profit'].some(k=>r[k]!==update[k])){changed=true;return update;}return r;});return changed?next:previous;});},[seed]);
    useEffect(()=>{const node=viewport.current;const observer=new ResizeObserver(()=>{const currentStep=Number(node.querySelector('svg')?.getAttribute('viewBox').split(' ')[2])/node.querySelectorAll('[role=button]').length;resizePosition.current=Math.round(node.scrollLeft/currentStep);setPlotWidth(node.clientWidth);});observer.observe(node);return()=>observer.disconnect();},[]);
    const step=plotWidth/7;
    useLayoutEffect(()=>{if(ready.current&&viewport.current&&resizePosition.current!==null)viewport.current.scrollLeft=resizePosition.current*step;resizePosition.current=null;},[step]);
    const finishDrag=e=>{if(!drag.current)return;if(suppressClick.current){e.currentTarget.scrollLeft=Math.round(e.currentTarget.scrollLeft/step)*step;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}drag.current=null;};
    const older=()=>{if(rows.length)void fetchRange(shiftDay(rows[0].day,-30),shiftDay(rows[0].day,-1),true);};
    const values=rows.flatMap(r=>[r.revenue,r.cost,r.profit]).filter(v=>v!==null),max=Math.max(100,...values),min=Math.min(0,...values),range=max-min;
    const y=v=>166-(v-min)/range*138,base=y(0),x=i=>(i+.5)*step,width=rows.length*step;
    return <section className={css.trend}><div className={css.sectionHead}><h3>{t('trend')}</h3><span className={css.hint}>{t('unit')}</span></div><div className={css.legend}>{['revenue','cost','profit'].map(k=><span key={k} data-color={k}>{t(k)}</span>)}</div>
    <div className={css.trendScroll} ref={viewport} tabIndex={0} role="region" aria-label={t('trendScroll')} onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,left:e.currentTarget.scrollLeft};suppressClick.current=false;}} onPointerMove={e=>{if(!drag.current)return;const distance=e.clientX-drag.current.x;if(Math.abs(distance)>5){suppressClick.current=true;e.currentTarget.setPointerCapture(e.pointerId);}if(suppressClick.current)e.currentTarget.scrollLeft=drag.current.left-distance;}} onPointerUp={finishDrag} onPointerCancel={finishDrag} onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();}}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.currentTarget.scrollLeft+=e.key==='ArrowLeft'?-step:step;}}} onScroll={e=>{if(ready.current&&e.currentTarget.scrollLeft<24&&!pending.current&&!error)older();}}><svg style={{width,minWidth:width}} viewBox={`0 0 ${width} 212`} role="group" aria-label={t('sevenDays')}>
    {[min,min+range/2,max].map((v,i)=><g key={i}><line x1="0" x2={width} y1={y(v)} y2={y(v)} className={css.axis}/></g>)}
    {rows.map((r,i)=><g key={r.day} opacity={r.day===day?1:.8}>{r.revenue!==null&&<rect x={x(i)-12} width="24" y={Math.min(base,y(r.revenue))} height={Math.abs(base-y(r.revenue))} rx="3" className={css.barActive}/>}{r.cost!==null&&<rect x={x(i)-12} width="24" y={Math.min(base,y(r.cost))} height={Math.abs(base-y(r.cost))} rx="3" className={css.costBar}/>}{r.revenue!==null&&r.cost>r.revenue&&<line x1={x(i)-12} x2={x(i)+12} y1={y(r.revenue)} y2={y(r.revenue)} className={css.revenueCap}/>}<text x={x(i)} y="199" textAnchor="middle" className={r.day===day?css.selectedLabel:css.dateLabel}>{r.day.slice(5)}</text><rect className={css.chartHit} role="button" aria-pressed={r.day===day} tabIndex={0} aria-label={`${r.day} ${t('selectedDay')} ${t('revenue')} ${money(r.revenue)}`} x={i*step} y="8" width={step} height="202" fill="transparent" onClick={()=>onDate(r.day)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onDate(r.day);}}}><title>{`${r.day} · ${t('revenue')} ${money(r.revenue)} · ${t('cost')} ${money(r.cost)} · ${t('profit')} ${money(r.profit)}`}</title></rect></g>)}
    {rows.map((r,i)=>r.profit!==null&&<g key={`profit-${r.day}`} pointerEvents="none">{i>0&&rows[i-1].profit!==null&&<line x1={x(i-1)} y1={y(rows[i-1].profit)} x2={x(i)} y2={y(r.profit)} className={css.profitLine}/>}<circle cx={x(i)} cy={y(r.profit)} r={r.day===day?4:3} className={css.profitPoint}/></g>)}</svg></div>
    {loading&&<span className={css.sr} role="status">{t('loading')}</span>}{error&&<p role="alert" className={css.error}>{error}</p>}</section>;
}
function CostChart({ summary, t }) {
    const [selected,setSelected]=useState(null);
    const detail=summary.costs.find(r=>r.category===selected);
    const total=summary.knownCost,positive=summary.costs.reduce((n,r)=>n+Math.max(0,r.amount||0),0);
    const cx=320,cy=270,outer=185,inner=103,point=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
    // Put the largest category near the middle, leaving small categories on either side.
    const sorted=summary.costs.map((r,i)=>({...r,i})).sort((a,b)=>(a.amount||0)-(b.amount||0));
    const ordered=[...sorted.filter((_,i)=>i%2===0),...sorted.filter((_,i)=>i%2===1).reverse()];
    let offset=0;
    const slices=ordered.map(r=>{const share=positive?Math.max(0,r.amount||0)/positive:0,start=Math.PI+offset*Math.PI;offset+=share;const end=Math.PI+offset*Math.PI,angle=(start+end)/2;const [x,y]=point(outer+26,angle);return {...r,share,start,end,angle,x,y,right:Math.cos(angle)>=0};});
    for(const right of [false,true]){
        const side=slices.filter(r=>r.right===right).sort((a,b)=>a.y-b.y);
        let previous=-30;side.forEach(r=>{r.y=Math.max(r.y,previous+48);previous=r.y;});
        if(side.length&&side.at(-1).y>285){const delta=side.at(-1).y-285;side.forEach(r=>r.y-=delta);}
    }
    return <section className={css.costSection}><div className={css.sectionHead}><h3>{t('costStructure')}</h3>{!summary.complete&&<span className={css.hint}>{t('partialCost')}</span>}</div><div className={css.costSemi}><svg viewBox="0 35 640 260" role="group" aria-label={t('costStructure')}>
        {!positive&&<path d="M 135 270 A 185 185 0 0 1 505 270 L 423 270 A 103 103 0 0 0 217 270 Z" fill="var(--z-soft)"/>}
        {slices.map(r=>{
            const gap=Math.min(.016,(r.end-r.start)/5),start=r.start+gap,end=r.end-gap;
            const p1=point(outer,start),p2=point(outer,end),p3=point(inner,end),p4=point(inner,start);
            const anchor=point(outer+5,r.angle),edgeX=r.x+(r.right?7:-7),textX=edgeX+(r.right?7:-7),inside=point((outer+inner)/2,r.angle);
            const share=r.amount==null?'—':`${(r.share*100).toFixed(1)}%`,fits=r.share>=.025;
            return <g key={r.category} role="button" tabIndex={0} aria-label={`${t(r.category)} ${share}`} aria-pressed={selected===r.category} className={css.semiSector} onClick={()=>setSelected(selected===r.category?null:r.category)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(selected===r.category?null:r.category);}if(e.key==='Escape')setSelected(null);}} style={{'--slice':`var(--z-series-${r.i})`}}>
                {r.share>0&&<path d={`M ${p1} A ${outer} ${outer} 0 0 1 ${p2} L ${p3} A ${inner} ${inner} 0 0 0 ${p4} Z`} className={css.semiSlice}/>}
                <line x1={anchor[0]} y1={anchor[1]} x2={edgeX} y2={r.y} className={css.semiLeader}/>
                <text x={textX} y={r.y-5} textAnchor={r.right?'start':'end'} className={css.semiLabel}><tspan x={textX}>{t(r.category)}{!fits?` · ${share}`:''}</tspan></text>
                {fits&&<text x={inside[0]} y={inside[1]} textAnchor="middle" dominantBaseline="central" transform={`rotate(${r.angle*180/Math.PI-(r.angle>Math.PI*1.5?360:180)} ${inside[0]} ${inside[1]})`} className={css.semiPercent} style={{fontSize:Math.max(10,Math.min(16,r.share*Math.PI*120-2))}}>{share}</text>}
            </g>;
        })}

    </svg></div>{detail&&<div className={css.costSelection} role="status"><span>{t(detail.category)}</span><span>{t('amount')} · {money(detail.amount)}</span><span>{t('share')} · {detail.amount==null?'—':positive?`${(Math.max(0,detail.amount)/positive*100).toFixed(1)}%`:'0%'}</span><span>{t(`${detail.basis}Basis`)}</span><button aria-label={t('close')} onClick={()=>setSelected(null)}>×</button></div>}{!total&&<p className={css.hint}>{t('noCost')}</p>}</section>;
}
function RulesForm({ t, rules, day, onSave, onCancel }) {
    const [effective, setEffective] = useState(day), [values, setValues] = useState(() => categories.map(category => { const r = rules.filter(r => r.category === category && r.effective <= day).sort((a, b) => b.effective.localeCompare(a.effective) || b.seq - a.seq)[0]; return { category, method: r?.method || (['materials', 'platform'].includes(category) ? 'percent' : 'monthly'), value: r ? (r.value / 100).toFixed(2) : '', base: r?.base || (category === 'platform' ? 'meituan' : 'all') }; }));
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const update = (i, key, value) => setValues(v => v.map((r, j) => i === j ? { ...r, [key]: value } : r));
    return <form className={css.form} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
        await onSave(values.map(r => ({ ...r, effective })));
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }}><div className={css.sectionHead}><h3>{t('rules')}</h3><button type="button" onClick={onCancel}>{t('cancel')}</button></div><p className={css.hint}>{t('rulesHint')}</p><label>{t('effective')}<input required type="date" value={effective} onChange={e => setEffective(e.target.value)}/></label>{values.map((r, i) => <div className={css.rule} key={r.category}><strong>{t(r.category)}</strong><label><span className={css.sr}>{t('method')}</span><select aria-label={`${t(r.category)} ${t('method')}`} value={r.method} onChange={e => update(i, 'method', e.target.value)}>{['monthly', 'daily', 'percent'].map(m => <option key={m} value={m}>{t(m)}</option>)}</select></label><label><span className={css.sr}>{t('value')}</span><input required aria-label={`${t(r.category)} ${t('value')}`} inputMode="decimal" value={r.value} placeholder="0.00" onChange={e => update(i, 'value', e.target.value)}/></label>{r.method === 'percent' && <label><span className={css.sr}>{t('base')}</span><select aria-label={`${t(r.category)} ${t('base')}`} value={r.base} onChange={e => update(i, 'base', e.target.value)}>{['all', ...channels].map(c => <option key={c} value={c}>{t(c)}</option>)}</select></label>}</div>)}<p className={css.hint}>{t('rulesRequired')}</p>{error && <p role="alert" className={css.error}>{error}</p>}<button className={css.primary} disabled={busy}>{t(busy ? 'saving' : 'saveRules')}</button></form>;
}
function PendingChanges({ proposals, t, busy, onAction }) {
    const entryText = r => `${r.day} · ${t(r.kind)} · ${t(r.category || r.channel || 'purchase')} · ${money(r.amount)} ${t('money')}${r.note ? ` · ${r.note}` : ''}`;
    const ruleText = r => r ? `${t(r.method)} · ${money(r.value)}${r.method === 'percent' ? '%' : ` ${t('money')}`}${r.base ? ` · ${t(r.base)}` : ''} · ${t('effective')} ${r.effective}` : t('missingBasis');
    return proposals.length > 0 && <section className={css.drafts}><h3>{t('pendingChanges')}</h3><p className={css.hint}>{t('pendingHint')}</p>{proposals.map(p => <div className={css.draft} key={p.id}>
        <div><strong>{t(p.type === 'rules' ? 'rules' : p.action)}</strong>{p.type === 'entry' ? <><p>{t('beforeChange')}: {entryText(p.before)}</p><p>{t('afterChange')}: {p.action === 'void' ? t('voided') : entryText(p.entry)}</p></> : p.rules.map(r => {
            const before = p.before.filter(old => old.category === r.category && old.effective <= r.effective).sort((a,b) => b.effective.localeCompare(a.effective) || b.seq-a.seq)[0];
            return <div key={r.category}><strong>{t(r.category)}</strong><p>{t('beforeChange')}: {ruleText(before)}</p><p>{t('afterChange')}: {ruleText(r)}</p></div>;
        })}</div><button disabled={busy} onClick={() => onAction(p, 'confirm')}>{t('applyChange')}</button><button disabled={busy} onClick={() => onAction(p, 'reject')}>{t('rejectChange')}</button>
    </div>)}</section>;
}
function LedgerPanel({ sessionId, t, shop, day, setDay, state, load, mutate, view, closePanel, openEntries }) {
    const [form, setForm] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [voidId, setVoidId] = useState(null);
    useEffect(() => { setForm(null); setError(''); setVoidId(null); }, [shop?.id]);
    const data = state.shop === shop?.id ? state.data : null;
    const save = async (payload) => { const result = await mutate({ shop: shop.id, ...payload }); setForm(null); await load(shop.id, day); return result; };
    const action = async (row, type, op = 'change') => { setBusy(true); setError(''); try {
        await save({ op, id: row.id, version: row.version, action: type });
        setVoidId(null);
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } };
    if (!shop)
        return <section className={css.empty}><Icon name="shop" size={30}/><h2>{t('pickShop')}</h2><p>{t('pickHint')}</p></section>;
    return <section className={css.ledger} data-view={view}><header className={css.header}><div><h1>{t(view)}</h1><p>{shop.title}</p></div><input type="date" aria-label={t('date')} value={day} onChange={e => { if (e.target.value)
        setDay(e.target.value); }}/></header>{(state.error || error) && <div role="alert" className={css.error}>{state.error || error}<button onClick={() => load(shop.id, day)}>{t('retry')}</button></div>}{form?.kind === 'entry' && form.row && <LedgerGrid key={form.row.id} shop={shop.id} entries={[form.row]} includeDrafts day={form.row.day} t={t} onSave={input => save(input)}/>}{form?.kind === 'rules' && <RulesForm t={t} rules={form.rules} day={form.day} onCancel={() => setForm(null)} onSave={rules => save({ op: 'rules', rules, version: form.version })}/>}{!data ? <p className={css.hint} role="status">{t('loading')}</p> : <>{view === 'overview' && <><PendingChanges proposals={data.proposals || []} t={t} busy={busy} onAction={(p, actionType) => action(p, actionType, 'proposal')}/>{data.entries.some(r => r.status === 'draft') && <section className={css.drafts}><h3>{t('drafts')}</h3><p className={css.hint}>{t('draftHint')}</p>{data.entries.filter(r => r.status === 'draft').map(r => <div className={css.draft} key={r.id}><div><strong>{r.day} · {t(r.kind)} · {t(r.category || r.channel || 'purchase')}</strong><p>{r.note}</p></div><b>{money(r.amount)}</b><button disabled={busy} onClick={() => action(r, 'confirm')}>{t('confirm')}</button><button disabled={busy} onClick={() => setForm({ kind: 'entry', row: r })}>{t('edit')}</button><button disabled={busy} onClick={() => action(r, 'void')}>{t('void')}</button></div>)}</section>}</>}{view === 'overview' ? <><div className={css.metrics}>{[['revenue', data.summary.revenue], ['cost', data.summary.cost], ['profit', data.summary.profit]].map(([k, n]) => <div key={k}><span>{t(k)}</span><strong data-profit={k === 'profit'}>{n === null ? t('missing') : money(n)}</strong></div>)}</div><Trend rows={data.trend} shop={shop.id} day={day} onDate={setDay} t={t}/><CostChart key={day} summary={data.summary} t={t}/><details className={css.costDetails}><summary>{t('details')}</summary><div className={css.sectionHead}><h3>{t('breakdown')}</h3><span className={css.hint}>{day}</span></div><table className={css.table}><thead><tr><th>{t('item')}</th><th>{t('basis')}</th><th>{t('amount')}</th></tr></thead><tbody>{data.summary.costs.map(r => <tr key={r.category}><td>{t(r.category)}</td><td className={css.muted}>{t(`${r.basis}Basis`)}{r.rule?.method === 'percent' && <small>{r.rule.value / 100}% · {t(r.rule.base)}</small>}</td><td>{r.amount === null ? t('missing') : money(r.amount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{t(data.summary.complete ? 'total' : 'known')}</th><td>{money(data.summary.knownCost)}</td></tr></tfoot></table>{!data.summary.complete && <p className={css.hint}>{t('costHint')}</p>}</details></> : <LedgerGrid key={shop.id} sessionId={sessionId} shop={shop.id} savedHistory={data.history||[]} entries={data.entries} day={day} t={t} onSave={payload => save(payload)}/> }</>}</section>;
}
function ProductViews({renderSlot}) { return <div className={css.transcript}>{renderSlot('conversation.session', {})}</div>; }
function Workbench(props) {
    const { useShopState, t, useSession, useSessions, useWorkspaces, useLedger, useProductNavigation, selectPage, openDemo, sessionId, renderFactorySlot, load, mutate, syncShop } = props;
    const session=useSession(s=>s), byId=useSessions(s=>s.byId), workspaces=useWorkspaces(s=>s.items.map(w=>({...w,id:w.workspaceId}))), state=useLedger(s=>s), nav=useProductNavigation(s=>s);
    const deletedShops=useShopState(s=>s.deleted);
    const cwd=sessionId?byId[sessionId]?.cwd:undefined, shop=shopForSession(workspaces.filter(w=>!deletedShops.includes(w.id)),sessionId,cwd), view=nav.shopId===shop?.id?nav.view:'home', split=view==='overview'||view==='entries';
    useEffect(()=>{if(shop)syncShop(shop.id);},[shop?.id,syncShop]);
    const [day,setDay]=useState(today), [mobile,setMobile]=useState('ledger'), [error,setError]=useState('');
    useEffect(()=>{if(!split)return;void load(shop?.id,day);const timer=setInterval(()=>{void load(shop?.id,day,true);},5000);return()=>clearInterval(timer);},[shop?.id,day,load,split]);
    useEffect(()=>{setMobile('ledger');},[view,shop?.id]);
    useEffect(()=>{if(view!=='overview'||!shop||!sessionId)return;let active=true;void api({op:'view-context',shop:shop.id,sessionId,day,section:null,search:''}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[view,shop?.id,sessionId,day]);
    const settling=session?.openState==='loading', hero=!session||session.blank&&!session.running&&!session.promptAttempted;
    const go=page=>selectPage(shop.id,page).catch(e=>setError(e.message));
    if(view==='home')return <main className={`${css.root} ${css.homeRoot}`}><header className={css.homeHeader}><span>{shop?.title||t('brand')}</span><span>{t('assistant')}</span></header><section className={css.homeWelcome}><BrandMark/><h1>{t(shop?'homeTitle':'homeNoShop')}</h1><p>{t('homeHint')}</p>{shop?<><div className={css.homeActions}><button className={css.primary} onClick={()=>go('overview')}><Icon name="chart"/>{t('openOverview')}</button><button onClick={()=>go('entries')}><Icon name="table"/>{t('openEntries')}</button><button onClick={()=>go('chat')}><Icon name="chat"/>{t('openChat')}</button></div><p className={css.homeGuide}>{t('homeGuide')}</p></>:<><p>{t('pickShop')}</p><button className={css.primary} onClick={()=>openDemo().catch(e=>setError(e.message))}>{t('loadDemo')}</button></>}{error&&<p role="alert" className={css.error}>{error}</p>}</section><footer className={css.homeFooter}>{t('homeReady')}</footer></main>;
    return <div className={`${css.root} ${split?'':css.chatOnly}`} data-mobile={mobile}>{split&&<><nav className={css.mobileTabs}>{['ledger','chat'].map(v=><button key={v} aria-pressed={mobile===v} onClick={()=>setMobile(v)}>{t(v==='ledger'?view:v)}</button>)}</nav><div className={css.dataPane}><LedgerPanel key={shop?.id} sessionId={sessionId} t={t} shop={shop} day={day} setDay={setDay} state={state} load={load} mutate={mutate} view={view} closePanel={()=>go('home')} openEntries={()=>go('entries')}/></div></>}<div className={css.chatPane}><div className={css.chatHeader}><BrandMark/><span>{t('brand')} · {t('assistant')}</span>{!split&&<button onClick={()=>go('home')}>{t('home')}</button>}</div>{hero&&<div className={css.welcome}><h2>{t('welcome')}</h2><p>{t(shop?'chatHint':'pickShop')}</p></div>}{sessionId&&renderFactorySlot('conversation.content',{variant:'embedded',phase:settling?'settling':'active',hero:false},{slots:{views:ProductViews}})}</div></div>;
}
export const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces', 'sessions'];
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh: { ...zh, ...conversationZh }, en: { ...en, ...conversationEn } }), 'zhuanleme: locales');
    ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@deepseek-ai/dsh-zhuanleme'; style.textContent = __PRODUCT_CSS__; document.head.append(style); return () => style.remove(); }, 'zhuanleme: styles');
    const models = new Map();
    ctx.effect(() => () => { for (const m of models.values())
        m.dispose(); models.clear(); }, 'zhuanleme: data models');
    const reviewListeners = new Set();
    const subscribeChanges = fn => { reviewListeners.add(fn); return () => reviewListeners.delete(fn); };
    const changed = shop => {
        for (const model of models.values()) {
            const state = model.getSnapshot();
            if (state.shop === shop && state.day) void model.load(shop, state.day, true);
        }
        for (const fn of reviewListeners) fn(shop);
    };
    const mutate = async body => { const result = await api(body); changed(body.shop); return result; };
    ctx.effect(() => () => reviewListeners.clear(), 'zhuanleme: review listeners');
    const shopActions=createShopActions(api);
    ctx.effect(()=>()=>shopActions.dispose(),'zhuanleme: shop actions');
    const navigation = ctx.uiWorkspace;
    const conversationActions = createConversationActions({ api, navigation });
    ctx.effect(() => () => conversationActions.dispose(), 'zhuanleme: conversation actions');
    const pageState = createNavigation();
    ctx.effect(() => () => pageState.dispose(), 'zhuanleme: navigation');
    let navigationGeneration=0;
    const selectPage=async (id,view) => { const version=++navigationGeneration; if(pageState.getSnapshot().shopId!==id)await navigation.openWorkspace(id); if(version===navigationGeneration)pageState.select(id,view); };
    const syncShop=id=>{if(pageState.getSnapshot().shopId!==id)pageState.select(id,'home');};
    const openDemo=async()=>{const result=await api({op:'create-demo'});await shopActions.load();await selectPage(result.workspace.id,'home');};
    const register = (name, component, options = {}) => ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -100, locale: NS, ...options }, component));
    for (const key of ['zhuanleme_draft', 'zhuanleme_change', 'zhuanleme_rules'])
        register('tool.call.toolview', ReviewCard, { key, inject: () => ({ changed, subscribeChanges }) });
    register('conversation.chat.turnTail', TurnReviews, { id: 'zhuanleme-review', inject: () => ({ changed, subscribeChanges }) });
    register('sidebar.brand.mark', BrandMark);
    register('sidebar.brand.name', BrandName);
    register('conversation.hero.brand.mark', BrandMark);
    register('conversation.input.right', VoiceInput, {id:'zhuanleme-voice'});
    register('sidebar.workspaces', Shops, { inject: () => ({ loadShops:shopActions.load, removeShop:shopActions.remove, restoreShop:shopActions.restore, hooks: { shopState:shopActions, productNavigation: pageState, conversationState: conversationActions }, reloadConversations: conversationActions.load, pinSession: conversationActions.pinSession, archiveSession: conversationActions.archiveSession, unarchiveSession: conversationActions.unarchiveSession, deleteSession: conversationActions.deleteSession, restoreSession: conversationActions.restoreSession, selectPage, openDemo, openShop: id => selectPage(id,'home'), openSession: async (id, shopId) => { await navigation.openSession(id); pageState.select(shopId,'chat'); }, newChat: async id => { await navigation.openWorkspace(id); pageState.select(id,'chat'); }, createShop: async (title) => { const result = await api({ op: 'create-shop', title }); await selectPage(result.workspace.id,'home'); } }) });
    register('main.conversation', Workbench, { inject: sessionId => { const key = sessionId || 'blank'; if (!models.has(key))
            models.set(key, createModel()); const model = models.get(key); return { hooks: { shopState:shopActions, ledger: model, productNavigation: pageState }, selectPage, openDemo, syncShop, load: model.load, mutate }; } });
}
