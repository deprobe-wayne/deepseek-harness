/** Use human message titles without an auxiliary model request, and repair old ACP error titles.
 * @param ctx Product context with the official Session title and Agent services.
 * @returns Completion after existing live conversations have been checked.
 */
export async function installConversationTitles(ctx) {
    ctx.effect(() => ctx.sessionTitle.register({
        id: 'zhuanleme-first-prompt', automatic: 'first-prompt',
        async generate(request) {
            request.signal.throwIfAborted();
            const first = request.messages[0];
            if (!first) throw new Error('没有可用的会话标题');
            return { title: first.text, messageSeqs: [first.seq] };
        },
    }), 'zhuanleme: conversation titles');
    const repair = async (agent, signal) => {
        const session = agent.session, current = ctx.sessionTitle.get(session);
        if (current?.source.kind !== 'provider' || !/^❌\s*\[ACP\]\s*stream error:/u.test(current.title)) return;
        const workspace = await ctx.workspaceRegistry.resolveByPath(session.header.cwd);
        signal?.throwIfAborted();
        if (workspace?.sessionIds?.includes(session.id)) await ctx.sessionTitle.refresh(session, signal);
    };
    ctx.on('agent/created', async ({ agent, signal }) => { await repair(agent, signal); });
    await Promise.all(ctx.agents.list().map(agent => repair(agent).catch(error => ctx.logger.warn('会话标题修复失败：%s', error.message))));
}
