import { createShopState } from './shop-state.mjs';
import { createVoiceBridge } from './voice.mjs';
import { backupShop, inspectBackup, restoreShop } from './backup.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDemoManager } from './demo.mjs';
import { createConversationState } from './conversation-state.mjs';
import { registerTools } from './tools.mjs';
import { Ledger, date, text } from './ledger.mjs';
export const name = 'zhuanleme';
export const inject = ['connection', 'webServer', 'workspaceRegistry', 'tools', 'profileContext', 'agents'];
/** Local-profile ledger. Authentication uses DSH's shared Connection API. */
export async function apply(ctx) {
    const profile = ctx.profileContext;
    if (!profile?.dir)
        throw new Error('赚了么需要通过 dsh Profile 启动');
    const dir = join(profile.dir, 'zhuanleme');
    await mkdir(dir, { recursive: true });
    const ledger = new Ledger(join(dir, 'ledger.sqlite'));
    ctx.effect(() => () => ledger.close(), 'zhuanleme: database');
    const conversations = createConversationState(join(dir, 'conversations.sqlite'), ctx.workspaceRegistry, { isRunning: id => ctx.agents.get(id)?.status === 'running' });
    ctx.effect(() => () => conversations.close(), 'zhuanleme: conversation state');
    const shops = createShopState(join(dir,'shops.sqlite'),ctx.workspaceRegistry,id=>ctx.agents.get(id)?.status==='running');
    ctx.effect(()=>()=>shops.close(),'zhuanleme: shop state');
    const voice = createVoiceBridge(ctx.tools,dir);
    const demo = await createDemoManager(dir, ctx.workspaceRegistry, ledger);
    const views = new Map();
    const report = (id, day) => ({ ...ledger.report(id, day), demo: demo.isDemo(id) });
    const shop = (id) => { if (typeof id !== 'string' || (!ctx.workspaceRegistry.get(id)||shops.deleted(id)))
        throw new Error('请先选择有效店铺'); return id; };
    ctx.connection.fetch.register({ path: '/api/zhuanleme', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async (request) => {
            try {
                const url = new URL(request.url);
                if (request.method === 'GET') {
                    const id = shop(url.searchParams.get('shop')), day = date(url.searchParams.get('day'));
                    return Response.json(report(id, day), { headers: { 'cache-control': 'no-store' } });
                }
                if (!request.headers.get('content-type')?.startsWith('application/json'))
                    return Response.json({ error: '需要 JSON 请求' }, { status: 415 });
                // Connection already validates Host, Origin and the browser credential before dispatch.
                const raw = await request.text();
                if (Buffer.byteLength(raw, 'utf8') > 32 * 1024 * 1024)
                    return Response.json({ error: '请求过大' }, { status: 413 });
                const input = JSON.parse(raw);
                if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('需要 JSON 对象');
                const shopState = shops.handle(input);
                if (shopState) return Response.json(shopState);
                const voiceResult = await voice.handle(input,request.signal);
                if (voiceResult) return Response.json(voiceResult);
                if (input.op === 'create-demo') { const result=await demo.ensure();shops.handle({op:'shop-restore',shop:result.workspace.id});return Response.json(result); }
                if (input.op === 'create-shop') {
                    const title = text(input.title, 60);
                    if (!title)
                        throw new Error('请输入店铺名字');
                    const folder = join(dir, 'shops', randomUUID());
                    await mkdir(folder, { recursive: true });
                    const workspace = await ctx.workspaceRegistry.create(folder, title);
                    return Response.json({ workspace: { id: workspace.id, title: workspace.title, path: workspace.path } });
                }
                const conversationResult = await conversations.handle(input);
                if (conversationResult) return Response.json(conversationResult, { headers: { 'cache-control': 'no-store' } });
                const id = shop(input.shop);
                if (input.op === 'review') {
                    if (!['entry', 'proposal'].includes(input.type)) throw new Error('核对类型不正确');
                    const itemId = text(input.id, 120);
                    if (!itemId) throw new Error('缺少核对记录');
                    const item = (input.type === 'entry' ? ledger.rows(id) : ledger.proposals(id)).find(row => row.id === itemId);
                    if (!item) throw new Error('核对记录不存在或不属于该店铺');
                    const workspace = ctx.workspaceRegistry.get(id);
                    return Response.json({ shop: { id, title: workspace.title }, type: input.type, item, demo: demo.isDemo(id) }, { headers: { 'cache-control': 'no-store' } });
                }
                if(input.op==='view-context') {
                    if(typeof input.sessionId!=='string'||!ctx.workspaceRegistry.get(id).sessionIds?.includes(input.sessionId)) throw new Error('当前对话不属于该店铺');
                    views.set(input.sessionId,{shop:id,day:date(input.day),section:['income','expenses'].includes(input.section)?input.section:null,search:typeof input.search==='string'?text(input.search,200):'',at:Date.now()});
                    return Response.json({ok:true});
                }
                if (['add','change','undo'].includes(input.op)) return Response.json(ledger.mutate(id, input));
                if (input.op === 'backup') return Response.json(backupShop(ledger,id));
                if (input.op === 'backup-preview') return Response.json(inspectBackup(input.backup));
                if (input.op === 'restore') return Response.json(restoreShop(ledger,id,input.backup,input.checksum));
                if (input.op === 'period') return Response.json(ledger.period(id, input.from, input.to, input));
                if (input.op === 'settings') return Response.json(ledger.setSettings(id,input));
                if (input.op === 'close-day') return Response.json(ledger.closeDay(id,input.day,input.channels));
                if (input.op === 'history') return Response.json({ history: ledger.history(id,100,input.before) });
                if (input.op === 'proposal') return Response.json(ledger.resolveProposal(id, input));
                if (input.op === 'rules') {
                    if (!Number.isSafeInteger(input.version) || input.version < 0) throw new Error('需要查询当前成本规则版本后再保存');
                    ledger.setRules(id, input.rules, input.version);
                    return Response.json({ ok: true });
                }
                throw new Error('未知操作');
            }
            catch (error) {
                return Response.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400, headers: { 'cache-control': 'no-store' } });
            }
        } });
    const capture = await readFile(new URL('../assets/voice-capture.js', import.meta.url));
    ctx.effect(() => ctx.webServer.register({ kind:'exact', path:'/zhuanleme/voice-capture.js', handler:(_req,res) => { res.writeHead(200, {'content-type':'text/javascript; charset=utf-8','cache-control':'no-cache'}); res.end(capture); } }), 'zhuanleme: microphone worklet');
    const logo = await readFile(new URL('../assets/logo.png', import.meta.url));
    for (const path of ['/zhuanleme/logo.png', '/favicon.svg'])
        ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler: (_req, res) => { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }); res.end(logo); } }), 'zhuanleme: brand asset');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/manifest.webmanifest', handler: (_req, res) => { res.writeHead(200, { 'content-type': 'application/manifest+json' }); res.end(JSON.stringify({ name: '赚了么', short_name: '赚了么', start_url: '/', display: 'standalone', icons: [{ src: '/zhuanleme/logo.png', sizes: '1254x1254', type: 'image/png' }] })); } }), 'zhuanleme: manifest');
    registerTools(ctx, ledger, report, exec=>{ const value=views.get(exec.agent.id);return value&&Date.now()-value.at<15*60*1000?value:null; },shops.deleted);
}
