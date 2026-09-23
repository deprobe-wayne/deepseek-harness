import { api } from './model.js';
import { LedgerManager } from './ledger-manager.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialReactTable, useMaterialReactTable, createRow, MRT_EditActionButtons } from 'material-react-table';
import { MRT_Localization_ZH_HANS } from 'material-react-table/locales/zh-Hans';
import { MRT_Localization_EN } from 'material-react-table/locales/en';
import { ThemeProvider, createTheme, Box, Button, Tabs, Tab, Menu, MenuItem, DialogTitle, DialogContent, DialogActions, Alert, Typography, Stack, IconButton, Tooltip, TextField, Divider, useMediaQuery } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UndoIcon from '@mui/icons-material/UndoOutlined';
import MoreIcon from '@mui/icons-material/MoreHoriz';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import * as XLSX from 'xlsx';
import { incomeTypes, expenseTypes, typeLabel, tableRows, initialSection, blankRow, savePayload, exportText } from './ledger-table-model.mjs';
import css from './ledger-grid.module.css';

// MRT supplies editing, sorting and menus; mutations use the shared persistent ledger.
export function LedgerGrid(props) {
    const [dark, setDark] = useState(() => document.body.hasAttribute('data-ds-dark-theme'));
    useEffect(() => {
        const observer = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')));
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        return () => observer.disconnect();
    }, []);
    const theme = useMemo(() => createTheme({
        palette: { mode: dark ? 'dark' : 'light', primary: { main: dark ? '#e4e7ec' : '#253041' } },
        typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 13, button: { textTransform: 'none', fontWeight: 600 } },
        shape: { borderRadius: 10 },
        components: { MuiButton: { defaultProps: { disableElevation: true } }, MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } } },
    }), [dark]);
    return <ThemeProvider theme={theme}><LedgerTable key={`${props.day}-${props.includeDrafts}`} {...props}/></ThemeProvider>;
}

function LedgerTable({ entries, day, t, onSave, shop, sessionId, savedHistory = [], includeDrafts = false }) {
    const [section, setSection] = useState(() => initialSection(entries, day, includeDrafts));
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [exportAnchor, setExportAnchor] = useState(null);
    const mobile = useMediaQuery('(max-width:600px)'), storageKey = 'zlm-draft:'+shop+':'+day;
    const readStored = () => { try { return JSON.parse(localStorage.getItem(storageKey)||'null'); } catch { return null; } };
    const [manager,setManager]=useState(null), [localDraft,setLocalDraft]=useState(()=>readStored()), [failed,setFailed]=useState(()=>readStored()?.failed||null), cancelledCell=useRef(null);
    const persist = value => { try { if(value)localStorage.setItem(storageKey,JSON.stringify(value));else localStorage.removeItem(storageKey);setLocalDraft(value); } catch { setError(t('draftStorageError')); } };
    const history=useRef(savedHistory); history.current=savedHistory;
    const historySize=savedHistory.filter(h=>h.canUndo).length;

    const pending = useRef(false), request = useRef(crypto.randomUUID()), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const data = useMemo(() => tableRows(entries, day, section, includeDrafts), [entries, day, section, includeDrafts]);
    const types = section === 'income' ? incomeTypes : expenseTypes;
    const columns = useMemo(() => [
        { accessorKey: 'dateTime', header: t('date'), size: 190, muiEditTextFieldProps: { type: 'text', required: true, placeholder: 'YYYY-MM-DD HH:mm', inputProps: { maxLength: 19 } } },
        { accessorKey:'refundOf', header:t('refundOf'), size:170, editVariant:'select', editSelectOptions:[{value:'',label:t('notRefund')},...entries.filter(r=>r.status==='posted'&&!r.refundOf).map(r=>({value:r.id,label:(r.note||t('unnamed'))+' · '+(r.amount/100).toFixed(2)}))], Cell:({cell})=>cell.getValue()?(entries.find(r=>r.id===cell.getValue())?.note||t('refund')):'—' },
        { accessorKey:'settlement', header:t('settlement'), size:120, editVariant:'select', editSelectOptions:['unknown','pending','paid'].map(value=>({value,label:t('settlement_'+value)})), Cell:({cell})=>t('settlement_'+(cell.getValue()||'unknown')) },
        { accessorKey:'account', header:t('account'), size:140 },
        { accessorKey:'mode', header:t('entryMode'), size:100, editVariant:'select', editSelectOptions:['transaction','summary'].map(value=>({value,label:t(value)})), Cell:({cell})=>t(cell.getValue()||'summary') },
        { accessorKey: 'note', header: t('item'), size: mobile ? 130 : 240, muiEditTextFieldProps: { inputProps: { maxLength: 200 } } },
        { accessorKey: 'amount', header: t('amount'), size: 140, sortingFn: (a, b) => (a.original.refundOf?-1:1)*Number(a.original.amount) - (b.original.refundOf?-1:1)*Number(b.original.amount), muiTableBodyCellProps: { align: 'right', sx: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 } }, muiTableHeadCellProps: { align: 'right' }, muiEditTextFieldProps: { required: true, inputProps: { inputMode: 'decimal' } }, Cell: ({ cell, row }) => (row.original.refundOf ? '-' : '') + Number(cell.getValue()).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        { accessorKey: 'type', header: t(section === 'income' ? 'channel' : 'gridType'), size: 160, editVariant: 'select', editSelectOptions: types.map(value => ({ value, label: typeLabel(value, t) })), filterVariant: 'select', filterSelectOptions: types.map(value => ({ value, label: typeLabel(value, t) })), Cell: ({ cell }) => typeLabel(cell.getValue(), t), muiEditTextFieldProps: { required: true } },
    ], [section, t, mobile, entries]);
    const reset = () => { setError(''); request.current = crypto.randomUUID(); };
    const save = async ({ row, values, table }, creating) => {
        if (pending.current) return;
        try {
            const payload = savePayload({ ...row.original, ...values, id: creating ? 'new' : row.original.id }, request.current, t);
            pending.current = true; setBusy(true); setError('');
            await onSave(payload);
            if (alive.current) { creating ? table.setCreatingRow(null) : table.setEditingRow(null); if(creating)persist(null); reset(); }
        } catch (reason) { if (alive.current) setError(reason.message); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
    };
    const commitCreation = (row, field, value) => {
        const values = { ...row.original, ...row._valuesCache, [field]: value };
        if (!String(values.amount ?? '').trim()) return;
        void save({ row, values, table }, true);
    };
    const commitCell = async (row, field, value, requestId = crypto.randomUUID()) => {
        if (pending.current || String(row[field]) === String(value)) return;
        pending.current = true; setBusy(true); setError(''); setFailed(null);
        try {
            await onSave(savePayload({ ...row, [field]: value }, requestId, t));
            if (alive.current) persist(null);
        } catch (reason) { if (alive.current) { const draft={row,field,value,requestId};setError(reason.message);setFailed(draft);persist({failed:draft}); } }
        finally { pending.current = false; if (alive.current) setBusy(false); }
    };
    const remove = async row => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try { await onSave({ op: 'change', id: row.id, version: row.version, action: 'void' }); }
        catch (reason) { if (alive.current) setError(reason.message); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
    };
    const undo = async () => {
        const operation = history.current.find(h=>h.canUndo)?.undo;
        if (!operation || pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try {
            await onSave({ op: 'undo', ...operation });

        } catch (reason) { if (alive.current) setError(reason.message); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
    };
    const dialogContent = ({ table, row, internalEditComponents }, creating) => <>
        <DialogTitle>{t(creating ? section === 'income' ? 'gridAddIncome' : 'gridAddExpense' : 'gridEditRecord')}</DialogTitle>
        <DialogContent><Stack spacing={2.5} sx={{ pt: 1 }}>{error && <Alert severity="error">{error}</Alert>}{internalEditComponents}</Stack></DialogContent>
        <DialogActions sx={{ p: 3 }}><Box component="fieldset" disabled={busy} sx={{ border: 0, m: 0, p: 0 }}><MRT_EditActionButtons variant="text" table={table} row={row}/></Box></DialogActions>
    </>;
    const download = (format, selected = false) => {
        try {
            const rows = (selected ? table.getSelectedRowModel() : table.getPrePaginationRowModel()).rows.map(row => row.original);
            const sheet = XLSX.utils.aoa_to_sheet([[t('date'), t('item'), t(section === 'income' ? 'channel' : 'gridType'), t('amount')], ...rows.map(row => [[row.day,row.time].filter(Boolean).join(' '), exportText(row.note), typeLabel(row.type, t), (row.refundOf?-1:1)*Number(row.amount)])]);
            sheet['!cols'] = [{ wch: 22 }, { wch: 36 }, { wch: 26 }, { wch: 16 }];
            const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, t(section === 'income' ? 'gridIncome' : 'gridExpenses'));
            XLSX.writeFile(book, `${t(section === 'income' ? 'gridIncome' : 'gridExpenses')}-${day}.${format}`, { bookType: format });
            setExportAnchor(null);
        } catch (reason) { setError(reason.message); }
    };
    const table = useMaterialReactTable({
        columns, data, getRowId: row => row.id,
        localization: { ...(t('gridIncome') === '收入' ? MRT_Localization_ZH_HANS : MRT_Localization_EN), create: t('gridAddRecord'), edit: t('gridEdit'), save: t('gridSave'), cancel: t('cancel'), actions: t('action') },
        createDisplayMode: 'row', editDisplayMode: includeDrafts ? 'modal' : 'cell', enableEditing: () => !pending.current && !failed, enableRowActions: true, enableRowSelection: false, enableColumnActions: false,
        enableColumnPinning: true, positionActionsColumn: 'last', paginationDisplayMode: 'pages',
        initialState: { density: 'comfortable', showGlobalFilter: false, pagination: { pageIndex: 0, pageSize: 10 }, columnOrder: mobile ? ['note','amount','dateTime','type','mode','refundOf','settlement','account','mrt-row-actions'] : ['dateTime','note','amount','type','mode','refundOf','settlement','account','mrt-row-actions'], columnVisibility: { dateTime: true, mode:false, refundOf:false, settlement:false, account:false }, columnPinning: { right: ['mrt-row-actions'] } },
        displayColumnDefOptions: { 'mrt-row-actions': { size: 44, minSize: 44, maxSize: 44, grow: false, header: '', muiTableHeadCellProps: { sx: { width: 44, minWidth: 44, maxWidth: 44, px: 0.5 } }, muiTableBodyCellProps: { align: 'center', sx: { width: 44, minWidth: 44, maxWidth: 44, px: 0.5, textAlign: 'center', verticalAlign: 'middle' } }, Cell: ({ row, table }) => <IconButton size="small" aria-label={t('gridDelete')} disabled={busy} onClick={() => { if (table.getState().creatingRow?.id === row.id) { table.setCreatingRow(null);persist(null); reset(); } else void remove({ ...row.original }); }} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}><DeleteIcon fontSize="small"/></IconButton> }, 'mrt-row-select': { size: 44 } },
        muiTablePaperProps: { elevation: 0, sx: { border: 0, borderRadius: 0, backgroundImage: 'none' } },
        muiTableContainerProps: { sx: { maxHeight: '65vh' } },
        muiTableProps: { 'aria-label': t(section === 'income' ? 'gridIncomeTable' : 'gridExpenseTable'), sx: { border: '1px solid', borderColor: 'divider', '& th, & td': { borderRight: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }, '& th:last-child, & td:last-child': { borderRight: 0 }, '& td:hover': { backgroundColor: 'action.hover' }, '& td:hover, & td:focus, & td:focus-within': { outline: 'none !important' }, '& td input, & td input:focus, & td input:focus-visible, & td .MuiSelect-select': { outline: 'none !important', boxShadow: 'none !important', border: '0 !important', borderRadius: 0, background: 'transparent' }, '& td .MuiTextField-root, & td .MuiInputBase-root': { font: 'inherit', letterSpacing: 'inherit', color: 'inherit', textAlign: 'inherit', transition: 'none' }, '& td .MuiInputBase-input': { font: 'inherit', letterSpacing: 'inherit', textAlign: 'inherit', height: 'auto', paddingTop: 0, paddingBottom: 0, transition: 'none' }, '& td fieldset': { border: 0 } } },
        muiTableBodyRowProps: ({ row }) => ({ 'data-grid-entry': row.id }),
        muiTableBodyCellProps: ({ cell, table }) => ({ onClick: () => { if (!pending.current && !failed && !localDraft && !table.getState().creatingRow && !table.getState().editingCell && cell.column.columnDef.columnDefType === 'data') { cancelledCell.current = null; table.setEditingCell(cell); } }, sx: { cursor: cell.column.columnDef.columnDefType === 'data' ? 'text' : 'default', py: 1.7, '&:focus-visible': { backgroundColor:'action.selected' } } }),
        muiTableHeadCellProps: { sx: { backgroundColor: 'background.default', color: 'text.secondary', fontWeight: 500, py: 1.4 } },
        muiSearchTextFieldProps: { placeholder: t('search'), size: 'small', variant: 'outlined', sx: { minWidth: 150 } },
        muiPaginationProps: { rowsPerPageOptions: [10, 20, 50], showFirstButton: true, showLastButton: true, shape: 'rounded', 'aria-label': t('pagination'), getItemAriaLabel: (type,page) => type === 'page' ? `${t('page')} ${page}` : t(type+'Page') },
        muiTopToolbarProps: { sx: { px: 2, py: 1.5, gap: 1, '& > .MuiBox-root': { gap: 1, flexWrap: 'wrap' } } },
        muiEditTextFieldProps: ({ cell, row, table }) => ({
            variant: 'standard', fullWidth: true, disabled: busy, autoFocus: !table.getState().creatingRow && !table.getState().editingRow, InputProps: { disableUnderline: true },
            onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && table.getState().creatingRow) commitCreation(row, cell.column.id, event.target.value); if (event.key === 'Escape' && !pending.current) { cancelledCell.current = cell.id; if (table.getState().creatingRow) {table.setCreatingRow(null);persist(null);} else table.setEditingCell(null); } },
            onChange: event => { if(table.getState().creatingRow) persist({section,requestId:request.current,row:{...row.original,...row._valuesCache,[cell.column.id]:event.target.value}}); if (['type','mode','settlement','refundOf'].includes(cell.column.id) && !table.getState().creatingRow && !table.getState().editingRow) { void commitCell({ ...row.original }, cell.column.id, event.target.value); table.setEditingCell(null); } },
            onBlur: event => {
                if (cancelledCell.current === cell.id) { cancelledCell.current = null; return; }
                if (table.getState().creatingRow && !event.currentTarget.closest('tr')?.contains(event.relatedTarget)) commitCreation(row, cell.column.id, event.target.value);
                if (!table.getState().creatingRow && !table.getState().editingRow && !['type','mode','settlement','refundOf'].includes(cell.column.id)) void commitCell({ ...row.original }, cell.column.id, event.target.value);
            },
        }),
        muiCreateRowModalProps: { fullWidth: true, maxWidth: 'sm', disableEscapeKeyDown: busy, onClose: () => { if (!pending.current) { table.setCreatingRow(null); reset(); } } },
        muiEditRowDialogProps: { fullWidth: true, maxWidth: 'sm', disableEscapeKeyDown: busy, onClose: () => { if (!pending.current) { table.setEditingRow(null); reset(); } } },
        onCreatingRowCancel: reset, onEditingRowCancel: reset,
        onCreatingRowSave: args => save(args, true), onEditingRowSave: args => save(args, false),
        renderCreateRowDialogContent: args => dialogContent(args, true), renderEditRowDialogContent: args => dialogContent(args, false),
        renderRowActions: ({ row }) => <Tooltip title={t('gridDelete')}><span><IconButton size="small" aria-label={t('gridDelete')} disabled={busy} onClick={event => { event.stopPropagation(); void remove({ ...row.original }); }} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main', backgroundColor: 'action.hover' } }}><DeleteIcon fontSize="small"/></IconButton></span></Tooltip>,
        renderTopToolbar: ({ table }) => !includeDrafts && <Box sx={{ pb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                <Tabs value={section} aria-label={t('gridSwitch')} onChange={(_, value) => { if (pending.current) return; setSection(value); table.resetColumnFilters(); table.resetGlobalFilter(); table.setPageIndex(0); reset(); }} sx={{ minHeight: 40 }}>
                    <Tab disabled={busy || !!table.getState().creatingRow} value="income" label={`${t('gridIncome')} · ${tableRows(entries,day,'income',includeDrafts).length}`} sx={{ minWidth: 64, minHeight: 40, px: 2 }}/><Tab disabled={busy || !!table.getState().creatingRow} value="expenses" label={`${t('gridExpenses')} · ${tableRows(entries,day,'expenses',includeDrafts).length}`} sx={{ minWidth: 64, minHeight: 40, px: 2 }}/>
                </Tabs>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Tooltip title={t('gridUndo')}><span><IconButton aria-label={t('gridUndo')} size="small" disabled={busy || !historySize || !!table.getState().creatingRow} onClick={() => void undo()}><UndoIcon fontSize="small"/></IconButton></span></Tooltip>
                    <Button size="small" startIcon={<AddIcon fontSize="small"/>} disabled={busy || !!failed || !!table.getState().creatingRow} onClick={() => { reset(); const stored=localDraft?.row;if(stored&&localDraft.requestId)request.current=localDraft.requestId; table.setCreatingRow(createRow(table, stored&&localDraft.section===section?stored:blankRow(day,section))); }}>{t('gridAddRecord')}</Button>
                    <IconButton size="small" aria-label={t('gridMore')} onClick={event => setExportAnchor(event.currentTarget)}><MoreIcon/></IconButton>
                </Stack>
            </Stack>
            <TextField size="small" variant="standard" placeholder={t('search')} value={table.getState().globalFilter ?? ''} onChange={event => table.setGlobalFilter(event.target.value)} InputProps={{ disableUnderline: true, startAdornment: <SearchIcon fontSize="small" sx={{ color: 'text.secondary', mr: 1 }}/> }} inputProps={{ 'aria-label': t('search') }} sx={{ width: '100%' }}/>
        </Box>,
        state: { isSaving: busy },
    });
    useEffect(()=>{table.setColumnOrder(mobile ? ['note','amount','dateTime','type','mode','refundOf','settlement','account','mrt-row-actions'] : ['dateTime','note','amount','type','mode','refundOf','settlement','account','mrt-row-actions']);},[mobile]);
    const search = table.getState().globalFilter || '';
    useEffect(()=>{if(!shop||!sessionId||includeDrafts)return;let disposed=false;const publish=()=>{void api({op:'view-context',shop,sessionId,day,section,search}).catch(error=>{if(!disposed)setError(error.message);});};const timer=setTimeout(publish,350),keep=setInterval(publish,60000);return()=>{disposed=true;clearTimeout(timer);clearInterval(keep);};},[shop,sessionId,day,section,search,includeDrafts]);
    useEffect(() => { if (includeDrafts && data[0]) table.setEditingRow(table.getRow(data[0].id)); }, []);
    return <section className={`${css.grid} zlm-ledger-ui`} aria-label={t('gridTitle')} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); void undo(); } }}>
        {localDraft && !failed && !table.getState().creatingRow && <Button size="small" onClick={()=>{setSection(localDraft.section||section);if(localDraft.requestId)request.current=localDraft.requestId;table.setCreatingRow(createRow(table,localDraft.row));}}>{t('resumeDraft')}</Button>}
        {(error || failed) && <Alert severity="error" sx={{ mb: 2 }} action={failed && <><Button size="small" disabled={busy} onClick={() => void commitCell(failed.row, failed.field, failed.value, failed.requestId)}>{t('gridRetry')}</Button><Button size="small" onClick={() => { setFailed(null); setError('');persist(null); }}>{t('cancel')}</Button></>}>{error || t('unsavedEdit')}{failed && ` (${t(failed.field === 'note' ? 'item' : failed.field === 'type' ? 'gridType' : failed.field)}: ${failed.value})`}</Alert>}
        {manager&&<LedgerManager kind={manager} shop={shop} day={day} t={t} onClose={()=>setManager(null)} onSave={onSave}/>}
        <MaterialReactTable table={table}/>
        <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
            <MenuItem disabled={busy || !data.length || !!table.getState().creatingRow || !!table.getState().editingCell || !!failed} onClick={() => download('xlsx')}>{t('gridExportExcel')}</MenuItem><MenuItem disabled={busy || !data.length || !!table.getState().creatingRow || !!table.getState().editingCell || !!failed} onClick={() => download('csv')}>{t('gridExportCSV')}</MenuItem>
            <Divider/>
            {['manageHistory','managePeriod','manageClose','manageBackup'].map(kind=><MenuItem key={kind} disabled={busy} onClick={()=>{setManager(kind);setExportAnchor(null);}} >{t(kind)}</MenuItem>)}
            <MenuItem onClick={() => { table.setShowColumnFilters(value => !value); setExportAnchor(null); }}>{t('gridFilters')}</MenuItem>
            <MenuItem onClick={() => { table.setDensity(table.getState().density === 'compact' ? 'comfortable' : 'compact'); setExportAnchor(null); }}>{t('gridDensity')}</MenuItem>
            <MenuItem onClick={() => { table.setIsFullScreen(value => !value); setExportAnchor(null); }}>{t('gridFullscreen')}</MenuItem>
            <MenuItem onClick={()=>{for(const id of ['mode','refundOf','settlement','account'])table.getColumn(id).toggleVisibility();setExportAnchor(null);}}>{t('extraFields')}</MenuItem>
            <MenuItem onClick={() => { table.getColumn('dateTime').toggleVisibility(); setExportAnchor(null); }}>{t(table.getColumn('dateTime').getIsVisible() ? 'gridHideDate' : 'gridShowDate')}</MenuItem>
        </Menu>
    </section>;
}
