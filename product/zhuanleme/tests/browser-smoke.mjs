import {fileURLToPath} from 'node:url';
import {chromium} from '../../../apps/web/node_modules/playwright/index.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
if(process.env.ZLM_ACCEPTANCE_PROFILE!=='zlm-test'||!process.env.ZLM_ACCEPTANCE_LOG)throw Error('Run only with an isolated zlm-test Profile and its ZLM_ACCEPTANCE_LOG');
const root=fileURLToPath(new URL('../',import.meta.url)), out=root+'/.impeccable/review';await mkdir(out,{recursive:true});
const url=(await readFile(process.env.ZLM_ACCEPTANCE_LOG,'utf8')).match(/dsh web: (http[^\s]+)/)?.[1];if(!url)throw Error('server not ready');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByRole('button',{name:/^(继续|稍后配置)$/}).first().waitFor({timeout:20000});if(await page.getByRole('button',{name:'继续',exact:true}).isVisible())await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'稍后配置',exact:true}).click();
 await page.getByRole('button',{name:'体验演示店',exact:true}).first().click();await page.getByRole('heading',{name:'把店铺经营，看得更清楚。',exact:true}).waitFor();
 if(await page.locator('[class*=dataPane]').count())throw Error('home is split');await page.screenshot({path:out+'/home.png',fullPage:true});
 await page.getByRole('button',{name:'演示店 · 青禾生活 · 经营总览',exact:true}).click();await page.getByText('8,920.00',{exact:true}).first().waitFor();await page.waitForTimeout(400);const conversationUrl=page.url();await page.screenshot({path:out+'/desktop.png',fullPage:true});
 await page.getByRole('button',{name:'演示店 · 青禾生活 · 账目明细',exact:true}).click();await page.getByPlaceholder('搜索备注或项目').waitFor();if(page.url()!==conversationUrl)throw Error('navigation replaced conversation');await page.screenshot({path:out+'/entries.png',fullPage:true});
 await page.getByRole('tab',{name:'支出',exact:true}).click();await page.getByPlaceholder('搜索备注或项目').fill('咖啡');if(await page.getByRole('table',{name:'支出明细表'}).locator('tr[data-grid-entry]').count()!==1)throw Error('search failed');await page.getByPlaceholder('搜索备注或项目').fill('');await page.getByRole('tab',{name:'收入',exact:true}).click();await page.getByRole('table',{name:'收入明细表',exact:true}).waitFor();
 await page.getByRole('button',{name:'演示店 · 青禾生活 · 经营总览',exact:true}).click();await page.getByText('8,920.00',{exact:true}).first().waitFor();await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme','true'));await page.screenshot({path:out+'/dark.png',fullPage:true});await page.evaluate(()=>document.body.removeAttribute('data-ds-dark-theme'));
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await page.screenshot({path:out+'/mobile.png',fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('mobile overflow');
 await page.getByRole('button',{name:'演示店 · 青禾生活 · 账目明细',exact:true}).click();await page.getByPlaceholder('搜索备注或项目').waitFor();await page.screenshot({path:out+'/mobile-entries.png',fullPage:true});
 await page.getByRole('button',{name:'AI 对话',exact:true}).click();await page.screenshot({path:out+'/mobile-chat.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'演示店 · 青禾生活',exact:true}).click();await page.getByRole('button',{name:'与 AI 协作',exact:true}).click();if(await page.locator('[class*=dataPane]').count())throw Error('chat should be single');const composer=await page.locator('[data-conversation-composer-seat], [data-composer-seat]').first().boundingBox();if(!composer||composer.y<650)throw Error('composer placement');
 if(errors.length)throw Error(JSON.stringify(errors));await writeFile(out+'/checks.json',JSON.stringify({ok:true,errors,checks:['home unsplit','retail demo data','sidebar overview','sidebar entries','conversation preserved','search','filter','dark capture','390px overflow','single AI chat']},null,2));console.log('UI revision checks passed');
}finally{await browser.close();}
