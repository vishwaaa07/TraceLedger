import fs from 'node:fs';
import os from 'node:os';
import {ingest} from '../src/ingest.ts';
import {analyze} from '../src/engine.ts';
const model=JSON.parse(fs.readFileSync('public/model/isolation-forest.json','utf8'));
const results=[];
const fixture=process.argv[2] || "../../work/bulk-review";
let reference;
for(const format of ['json','csv','xml']) {
 const text=fs.readFileSync(`${fixture}.${format}`,'utf8');
 const start=performance.now();const d=await ingest(text,format);const parsed=performance.now();const a=analyze(d,model);const done=performance.now();
 const signature=JSON.stringify(a.alerts.map(x=>[x.txid,x.score]));
 if(reference && reference !== signature) throw Error('Formats differ');reference=signature;
 results.push({format,bytes:Buffer.byteLength(text),records:d.rows,transactions:d.transactions.length,observations:d.observations.length,rejected:d.rejected,ingestMs:parsed-start,analysisMs:done-parsed,totalMs:done-start,heapUsedAfter:process.memoryUsage().heapUsed});
}
const report={environment:{node:process.version,os:os.type(),cpu:os.cpus()[0].model},method:'One sequential run per format, same seed 884 / 2500 complete scenarios. Memory is a post-run snapshot, not peak. Node measurements exclude browser transfer/rendering. Matching transaction scores verified across all formats.',results};fs.writeFileSync('docs/bulk-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
