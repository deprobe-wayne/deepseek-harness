import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as plugin from '../src/host.mjs';
test('Cordis unload removes plugin tools and routes; reloading reopens the durable ledger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zlm-life-')), ctx = new Context();
    const routes = new Map();
    try {
        await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
        ctx.provide('profileContext', { dir });
        ctx.provide('agents', { get: () => undefined });
        ctx.provide('workspaceRegistry', { resolveByPath: async () => ({ id:'shop' }), get: () => ({ id:'shop' }) });
        // Only transport registration is stubbed; Cordis owns each actual registration effect.
        ctx.provide('webServer', { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } });
        ctx.provide('connection', { fetch: { register(route) { return ctx.effect(() => { routes.set(route.path,route); return () => routes.delete(route.path); }); } } });
        const fiber = ctx.plugin(plugin); await fiber;
        assert.equal(ctx.tools.schemas().filter(t => t.name.startsWith('zhuanleme_')).length, 5);
        const exec = { signal: new AbortController().signal, callId:'call', agent:{ session:{ header:{cwd:'/shop'} } } };
        const result = await ctx.tools.execute({ ...exec, name:'zhuanleme_draft', arguments:{day:'2026-09-22',kind:'purchase',amount:'860',request:'life'} });
        assert.equal(result.isError, false);
        await fiber.dispose();
        assert.equal(ctx.tools.schemas().filter(t => t.name.startsWith('zhuanleme_')).length, 0);
        // Connection's own service effect emulates transport ownership separately.
        assert.equal(routes.has('/zhuanleme/logo.png'), false);
        const reloaded = ctx.plugin(plugin); await reloaded;
        const report = await ctx.tools.execute({ ...exec, callId:'report', name:'zhuanleme_report', arguments:{day:'2026-09-22'} });
        assert.equal(report.value.entries[0].id, result.value.id);
        await reloaded.dispose();
    } finally { await ctx.fiber.dispose(); await rm(dir, {recursive:true,force:true}); }
});
