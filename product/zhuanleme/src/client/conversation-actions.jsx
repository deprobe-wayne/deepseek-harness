import React, { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { groupConversations } from './conversation-model.js';
import css from './conversation-actions.module.css';

function Glyph({ name, size = 16 }) {
    const paths = { chat: 'M5 6h14v10H9l-4 4z', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', chevron: 'm9 5 7 7-7 7', pin: 'm15 3 6 6-4 1-3 5-4-1-6 6 6-6-1-4 5-3z', archive: 'M3 3h18v5H3zM5 8v12h14V8M9 12h6', restore: 'M4 10a8 8 0 1 1 0 7M4 4v6h6', trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7' };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'more' ? <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></> : <path d={paths[name]}/>}</svg>;
}

// The native top layer keeps menus out of the sidebar's scrolling layout.
function ActionMenu({ anchor, label, onClose, children }) {
    const menu = useRef(null), close = useRef(onClose);
    close.current = onClose;
    useLayoutEffect(() => {
        const node = menu.current;
        if (!node || !anchor.current) return;
        const place = () => {
            const rect = anchor.current?.getBoundingClientRect();
            if (!rect) return;
            const bounds = node.getBoundingClientRect();
            node.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
            node.style.top = `${Math.max(8, rect.bottom + bounds.height + 6 < window.innerHeight ? rect.bottom + 6 : rect.top - bounds.height - 6)}px`;
        };
        const toggled = event => { if (event.newState === 'closed') close.current(); };
        const outside = event => { if (!node.contains(event.target) && !anchor.current?.contains(event.target)) close.current(); };
        document.addEventListener('pointerdown', outside, true);
        node.addEventListener('toggle', toggled);
        node.showPopover();
        place();
        const observer = new ResizeObserver(place);
        observer.observe(node);
        node.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
        window.addEventListener('resize', place);
        document.addEventListener('scroll', place, true);
        return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside, true); node.removeEventListener('toggle', toggled); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
    }, [anchor]);
    return <div ref={menu} popover="manual" role="menu" aria-label={label} className={css.menu} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) onClose(); }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); anchor.current?.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const items = [...menu.current.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        }
    }}>{children}</div>;
}

function ConversationRow({ row, pinned, pinSession, view, workspaceId, t, openSession, archiveSession, unarchiveSession, deleteSession, restoreSession, running }) {
    const [menuOpen, setMenuOpen] = useState(false), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const pending = useRef(false), actionButton = useRef(null), mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const title = row.title || t('newChat');
    const close = () => { setMenuOpen(false); setConfirming(false); };
    const run = async action => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try { await action(); if (mounted.current) close(); }
        catch (reason) { if (mounted.current) setError(reason.message || t('failed')); }
        finally { pending.current = false; if (mounted.current) setBusy(false); }
    };
    const menuItem = (key, icon, action, danger = false, disabled = false) => <button type="button" role="menuitem" className={danger ? css.danger : undefined} disabled={busy || disabled} onClick={() => void run(action)}><Glyph name={icon}/>{t(key)}</button>;
    return <li className={css.row} data-zlm-session={row.id} data-menu-open={menuOpen} aria-busy={busy} onContextMenu={event => { event.preventDefault(); setConfirming(false); setMenuOpen(true); }} onKeyDown={event => { if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); setMenuOpen(true); } }}>
        <div className={css.rowMain}>
            {view === 'active' ? <button type="button" className={css.open} title={title} disabled={busy} aria-current={(row.retainedBy?.mainView || 0) > 0 ? 'page' : undefined} onClick={() => void run(() => openSession(row.id, workspaceId))}>
                {pinned && <Glyph name="pin" size={13}/>}<span>{title}</span>{running && <span className={css.running} role="status" aria-label={t('conversationRunning')}/>}
            </button> : <span className={css.historyTitle} title={title}>{title}</span>}
            <div className={css.rowActions}>
                <button type="button" className={css.iconButton} title={t(view === 'active' ? 'archiveConversation' : view === 'archived' ? 'unarchiveConversation' : 'restoreConversation')} aria-label={`${title} · ${t(view === 'active' ? 'archiveConversation' : view === 'archived' ? 'unarchiveConversation' : 'restoreConversation')}`} disabled={busy || running} onClick={() => void run(() => view === 'active' ? archiveSession(row.id) : view === 'archived' ? unarchiveSession(row.id) : restoreSession(row.id, workspaceId))}><Glyph name={view === 'active' ? 'archive' : 'restore'}/></button>
                <button ref={actionButton} type="button" className={css.iconButton} title={t('conversationActions')} aria-label={`${title} · ${t('conversationActions')}`} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => { setConfirming(false); setMenuOpen(!menuOpen); }}><Glyph name="more"/></button>
            </div>
        </div>
        {menuOpen && <ActionMenu anchor={actionButton} label={`${title} · ${t('conversationActions')}`} onClose={close}>
            {confirming ? <><p className={css.confirmTitle}>{t('deleteConversationTitle')}</p><p className={css.confirmHint}>{t('deleteConversationHint')}</p>{menuItem('deleteConversationConfirm', 'trash', () => deleteSession(row.id, workspaceId), true, running)}<button type="button" role="menuitem" onClick={close}>{t('cancel')}</button></> : <>
                {view === 'active' && <>{menuItem(pinned ? 'unpinConversation' : 'pinConversation', 'pin', () => pinSession(row.id, workspaceId, !pinned))}{menuItem('archiveConversation', 'archive', () => archiveSession(row.id), false, running)}</>}
                {view === 'archived' && menuItem('unarchiveConversation', 'restore', () => unarchiveSession(row.id))}
                {view === 'deleted' ? menuItem('restoreConversation', 'restore', () => restoreSession(row.id, workspaceId)) : <button type="button" role="menuitem" className={css.danger} disabled={busy || running} onClick={() => setConfirming(true)}><Glyph name="trash"/>{t('deleteConversation')}</button>}
            </>}
            {error && <p className={css.error} role="alert">{error}</p>}
        </ActionMenu>}
        {error && !menuOpen && <p className={css.error} role="alert">{error}</p>}
    </li>;
}

function HistoryDialog({ view, groups, workspace, t, onClose, rowProps, state, reload, statuses }) {
    const dialog = useRef(null), headingId = useId();
    const [query, setQuery] = useState('');
    useEffect(() => { dialog.current.showModal(); dialog.current.querySelector('input')?.focus({ preventScroll: true }); }, []);
    const rows = groups[view].filter(row => (row.title || t('newChat')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return <dialog ref={dialog} className={css.historyDialog} aria-labelledby={headingId} onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
        <header className={css.dialogHeader}><div><h2 id={headingId}>{t(view === 'archived' ? 'archivedChats' : 'deletedChats')}</h2><p>{workspace.title}</p></div><button type="button" className={css.iconButton} aria-label={t('close')} onClick={onClose}><Glyph name="close"/></button></header>
        <input autoFocus className={css.search} aria-label={t('conversationSearch')} placeholder={t('conversationSearch')} value={query} onChange={event => setQuery(event.target.value)}/>
        <div className={css.historyBody}>
            {state.error ? <div className={css.error} role="alert">{t('conversationStateError')}<button type="button" onClick={() => void reload()}>{t('conversationRetry')}</button></div> : <><ul className={css.list}>{rows.map(row => <ConversationRow key={row.id} {...rowProps} row={row} view={view} running={statuses?.get(row.id)?.running ?? row.running}/>)}</ul>{!rows.length && <p className={css.empty}>{t(query ? 'noConversationMatches' : view === 'archived' ? 'emptyArchivedConversations' : 'emptyDeletedConversations')}</p>}</>}
        </div>
    </dialog>;
}

/** Shop navigation keeps recent chats inline and manages hidden history in a separate dialog. */
export function ConversationList({ navigationClassName, active, newChat, pinSession, workspace, sessions, archivedSessionIds, state, statuses, t, openSession, archiveSession, unarchiveSession, deleteSession, restoreSession, reload }) {
    const [query, setQuery] = useState(''), [limit, setLimit] = useState(6), [history, setHistory] = useState(null), [managementOpen, setManagementOpen] = useState(false);
    const [expanded, setExpanded] = useState(false), [creating, setCreating] = useState(false), [createError, setCreateError] = useState('');
    const contentId = useId(), creatingRef = useRef(false), managementButton = useRef(null);
    const create = async () => {
        if (creatingRef.current) return;
        creatingRef.current = true; setCreating(true); setCreateError(''); setExpanded(true); setQuery('');
        try { await newChat(workspace.id); }
        catch (error) { setCreateError(error.message || t('failed')); }
        finally { creatingRef.current = false; setCreating(false); }
    };
    const groups = groupConversations(workspace, sessions, archivedSessionIds, state.deletedSessionIds, state.pinnedSessionIds);
    const filtered = groups.active.filter(row => (row.title || t('newChat')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const rowProps = { pinSession, workspaceId: workspace.id, t, openSession, archiveSession, unarchiveSession, deleteSession, restoreSession };
    return <section className={css.conversations} aria-label={`${workspace.title} · ${t('conversations')}`}>
        <div className={css.heading}>
            <button type="button" className={`${navigationClassName} ${css.toggle}`} aria-label={`${workspace.title} · ${t('conversations')}`} aria-expanded={expanded} aria-controls={contentId} aria-current={active ? 'page' : undefined} onClick={() => setExpanded(value => !value)}><Glyph name="chat" size={15}/><span>{t('conversations')}</span><span className={css.chevron} data-expanded={expanded}><Glyph name="chevron" size={12}/></span></button>
            <button ref={managementButton} type="button" className={`${css.iconButton} ${css.manage}`} title={t('manageConversations')} aria-label={`${workspace.title} · ${t('manageConversations')}`} aria-haspopup="menu" aria-expanded={managementOpen} onClick={() => setManagementOpen(!managementOpen)}><Glyph name="more"/></button>
            <button type="button" className={css.iconButton} title={t('newChat')} aria-label={`${workspace.title} · ${t('newChat')}`} disabled={creating} onClick={() => void create()}><Glyph name="plus" size={18}/></button>
        </div>
        {managementOpen && <ActionMenu anchor={managementButton} label={t('manageConversations')} onClose={() => setManagementOpen(false)}>{['archived', 'deleted'].map(view => <button type="button" role="menuitem" key={view} onClick={() => { setManagementOpen(false); setHistory(view); }}><Glyph name={view === 'archived' ? 'archive' : 'trash'}/>{t(view === 'archived' ? 'archivedChats' : 'deletedChats')}</button>)}</ActionMenu>}
        <div className={css.content} id={contentId} hidden={!expanded}>
            {createError && <p className={css.error} role="alert">{createError}</p>}
            {(groups.active.length > 6 || query) && <input className={css.search} aria-label={t('conversationSearch')} placeholder={t('conversationSearch')} value={query} onChange={event => { setQuery(event.target.value); setLimit(6); }}/>}
            {state.loading ? <p className={css.hint} role="status">{t('conversationStateLoading')}</p> : state.error ? <div className={css.error} role="alert"><p>{t('conversationStateError')}</p><button type="button" onClick={() => void reload()}>{t('conversationRetry')}</button></div> : <>
                <ul className={css.list}>{filtered.slice(0,limit).map(row => <ConversationRow key={row.id} {...rowProps} row={row} pinned={state.pinnedSessionIds?.includes(row.id) || false} view="active" running={statuses?.get(row.id)?.running ?? row.running}/>)}</ul>
                {!filtered.length && <p className={css.hint}>{t(query ? 'noConversationMatches' : 'emptyConversations')}</p>}
                {filtered.length > limit && <button className={css.showMore} type="button" onClick={() => setLimit(limit + 12)}>{t('moreConversations')}</button>}
            </>}
        </div>
        {history && <HistoryDialog view={history} groups={groups} workspace={workspace} t={t} rowProps={rowProps} statuses={statuses} state={state} reload={reload} onClose={() => { setHistory(null); managementButton.current?.focus(); }}/>}</section>;
}
