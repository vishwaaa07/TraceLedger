import fs from 'node:fs';
import path from 'node:path';
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));const entries=[];
for(const [name,pkg] of Object.entries(lock.packages)){if(!name||pkg.dev)continue;const dir=path.resolve(name);if(!fs.existsSync(dir))continue;const names=fs.readdirSync(dir).filter(n=>/^(license|copying|notice)(\.|$)/i.test(n));entries.push(`\n=== ${name.replace(/^node_modules\//,'')} ${pkg.version} | ${pkg.license||'See text'} ===\n`);for(const n of names){const f=path.join(dir,n);if(fs.statSync(f).isFile())entries.push(fs.readFileSync(f,'utf8'));}}
fs.writeFileSync('public/THIRD_PARTY_NOTICES.txt','Trace Ledger bundled dependency notices\n'+entries.join('\n'));
