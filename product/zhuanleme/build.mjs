import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const require=createRequire(new URL('package.json',root));
const tsxRequire=createRequire(require.resolve('tsx/package.json'));
const {build}=tsxRequire('esbuild');
await mkdir(new URL('lib/',import.meta.url),{recursive:true});
const licenses = await Promise.all(['material-react-table', '@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled', 'xlsx'].map(async name => `${name}\n${await readFile(new URL(`node_modules/${name}/LICENSE`, import.meta.url), 'utf8')}`));
await writeFile(new URL('lib/THIRD_PARTY_LICENSES.txt', import.meta.url), licenses.join('\n\n'));

const result=await build({entryPoints:[new URL('src/client/index.jsx',import.meta.url).pathname],bundle:true,write:false,outfile:new URL('lib/client.js',import.meta.url).pathname,format:'cjs',platform:'browser',target:'es2022',external:['react','react/jsx-runtime','react-dom','react-dom/client'],jsx:'automatic',define:{__PRODUCT_CSS__:'__ZLM_CSS_PLACEHOLDER__'},minify:false});
await writeFile(new URL('lib/client.js',import.meta.url),`window.__ModuleLoader__.load({id:"@deepseek-ai/dsh-zhuanleme",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('__ZLM_CSS_PLACEHOLDER__',JSON.stringify((result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'')))}\nreturn module.exports;}});\n`);
console.log('Built 赚了么 client');
// Keep full dependency notices in the browser distribution, not only node_modules.
const clientPath = new URL('lib/client.js', import.meta.url);
await writeFile(clientPath, `/*! Third-party licenses\n${licenses.join('\n\n').replaceAll('*/', '* /')}\n*/\n${await readFile(clientPath, 'utf8')}`);
