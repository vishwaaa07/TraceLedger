import fs from 'node:fs';
import os from 'node:os';
import {ingest} from '../src/ingest.ts';
import {analyze} from '../src/engine.ts';
const model=JSON.parse(fs.readFileSync('public/model/isolation-forest.json','utf8'));
const files=['public/data/sample.json',...(process.argv[2]?[process.argv[2]]:[])];const results=[];
for(const file of files){const text=fs.readFileSync(file,'utf8');const before=process.memoryUsage();const start=performance.now();const d=await ingest(text,'json');const parsed=performance.now();const a=analyze(d,model);const end=performance.now(),after=process.memoryUsage();results.push({file:file.split(/[\\/]/).at(-1),bytes:Buffer.byteLength(text),sourceRecords:d.rows,transactions:d.transactions.length,observations:d.observations.length,rejected:d.rejected,parseValidateHashMs:parsed-start,analysisMs:end-parsed,totalMs:end-start,heapUsedBefore:before.heapUsed,heapUsedAfter:after.heapUsed,rssAfter:after.rss,graphElements:a.elements.length});}
const report={environment:{node:process.version,os:os.type()+' '+os.release(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length},method:'Single Node process, one run each. Memory snapshots are not peak memory; excludes browser rendering. No performance guarantee.',results};fs.writeFileSync('docs/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
