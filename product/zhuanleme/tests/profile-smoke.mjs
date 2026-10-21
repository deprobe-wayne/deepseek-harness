/** Built Profile smoke; all writes are confined to a fresh temporary DSH_HOME. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, copyFile, chmod, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const home = await mkdtemp(join(tmpdir(), 'zlm-audit-'));
const overlay = join(home, 'audit.yml');
const require = createRequire(join(root, 'apps/cli/package.json'));
const live = process.env.ZLM_AUDIT_LIVE === '1';
const browserCheck = process.env.ZLM_AUDIT_BROWSER === '1' || process.argv.includes('--browser');
const selection = live ? require('js-yaml').load(await readFile(join(root, '../.dsh-home/settings.yaml'), 'utf8'))['agent-default-model'] : {};
if (live) {
    for (const file of ['settings.yaml', '.credentials.yaml']) {
        await copyFile(join(root, '../.dsh-home', file), join(home, file));
        await chmod(join(home, file), 0o600);
    }
}
const { evaluatePluginCompatibility } = await import('../../../packages/boot/app-boot/lib/index.js');
for (const manifestPath of ['product/zhuanleme/package.json', '../plugins/dsh-voice/package.json']) {
    const manifest = JSON.parse(await readFile(join(root, manifestPath), 'utf8'));
    assert.equal(evaluatePluginCompatibility(manifest), undefined, `${manifest.name} must support this DSH runtime`);
}
const profileDir = join(home, 'profiles/zlm-audit');
const dependencies = {
    '@deepseek-ai/dsh-zhuanleme': join(root, 'product/zhuanleme'),
    '@goodandready/dsh-voice': join(root, '../plugins/dsh-voice'),
};
await mkdir(profileDir, { recursive: true });
for (const [name, path] of Object.entries(dependencies)) {
    await mkdir(join(profileDir, 'node_modules', name.split('/')[0]), { recursive: true });
    await symlink(path, join(profileDir, 'node_modules', name), 'dir');
}
await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-zlm-audit', private: true,
    dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, path]) => [name, `link:${path}`])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...Object.keys(dependencies)] } },
}));
await writeFile(join(profileDir, 'cordis.patch.yml'), '- id: dsh-voice\n  config:\n    whisperAutostart: false\n    sensevoiceAutostart: false\n');
await writeFile(overlay, `- id: session-title-llm\n  disabled: true\n${live ? '' : '- id: llm-pi-ai\n  disabled: true\n'}- insert:\n    - id: zlm-audit\n      name: '${root}/product/zhuanleme/tests/profile-fixture.mjs'\n`);
const child = spawn(fileURLToPath(new URL('../../../../dsh', import.meta.url)), ['zlm-audit', '--patch', overlay, '--no-open', '--port', '0'], { env: { ...process.env, DSH_HOME: home, ZLM_AUDIT_PROVIDER: selection.provider, ZLM_AUDIT_MODEL: selection.model, ZLM_AUDIT_EFFORT: selection.reasoningEffort }, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
const exited = new Promise(resolve => child.on('exit', resolve));
try {
    const deadline = Date.now() + (live ? 390000 : 45000);
    while (!log.includes('ZLM_AUDIT_OK ') && Date.now() < deadline) {
        if (child.exitCode !== null || log.includes('ZLM_AUDIT_ERROR')) throw new Error(log.replace(/https?:\/\/\S+/g, '[local URL]'));
        await new Promise(r => setTimeout(r, 100));
    }
    const match = log.match(/ZLM_AUDIT_OK (.+)/);
    assert(match, 'Profile smoke timed out: '+log.replace(/https?:\/\/\S+/g, '[local URL]'));
    const result = JSON.parse(match[1]);
    const url = log.match(/dsh web: (http\S+)/)?.[1];
    assert(url, 'Missing local web endpoint');
    await writeFile(join(home, 'browser-context.json'), JSON.stringify({ url, ...result }));
    console.log((live ? 'Live model' : 'Profile loop') + ' passed: exact draft and entry/rule proposals verified in SQLite.');
    console.log(`Isolated evidence: ${home}`);
    if (process.argv.includes('--inspect')) {
        console.log('Ready for browser inspection; stop this command when finished.');
        await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
    }
    if (browserCheck) {
        const { verifyBrowser } = await import('./review-smoke.mjs');
        await verifyBrowser(home, { url, ...result });
    }
    const events = JSON.parse(await readFile(join(home, 'profiles/zlm-audit/audit-session.json'), 'utf8'));
    const transcript = events.filter(e => ['tool/call','tool/result','turn/end'].includes(e.type)).map(e => ({type:e.type, data:e.data}));
    await mkdir(join(root, 'product/zhuanleme/evidence'), { recursive: true });
    await writeFile(join(root, live ? 'product/zhuanleme/evidence/live-model-smoke.json' : 'product/zhuanleme/evidence/profile-smoke.json'), JSON.stringify({ passed:true, liveModel:live, ...(live ? {provider:selection.provider, model:selection.model, reasoningEffort:selection.reasoningEffort} : {}), tools:transcript.filter(e=>e.type==='tool/result').length, modelRequests:result.turns, providerRetries:events.filter(e=>e.type==='llm/retry').length, recoveredToolErrors:result.recoveredToolErrors, pendingChanges:result.roundtrip?0:2, multiTurnRoundtrip:!!result.roundtrip, checkedAt:new Date().toISOString(), confirmedByBrowser:browserCheck },null,2)+'\n');
    assert(transcript.filter(e => e.type === 'tool/result').length >= 3);
} finally { if (live) { await unlink(join(home, '.credentials.yaml')); await unlink(join(home, 'settings.yaml')); } await writeFile(join(home, 'startup.log'), log); console.log('Audit logs: '+home); child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(force); }
