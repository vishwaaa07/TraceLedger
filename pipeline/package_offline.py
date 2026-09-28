"""Deterministic archive of the already-built static app (stdlib only)."""
import argparse, json, tarfile, hashlib, gzip
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',default=str(ROOT.parent/'trace-ledger-offline.tar.gz'));a=p.parse_args()
files=sorted(x for x in (ROOT/'dist').rglob('*') if x.is_file() and x.name!='SHA256SUMS.json')
manifest={x.relative_to(ROOT/'dist').as_posix():hashlib.sha256(x.read_bytes()).hexdigest() for x in files}
(ROOT/'dist/SHA256SUMS.json').write_text(json.dumps(manifest,indent=2))
with open(a.output,'wb') as raw, gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as gz, tarfile.open(fileobj=gz,mode='w') as tar:
 def add(f,name):
  info=tar.gettarinfo(str(f),name);info.mtime=0;info.uid=info.gid=0;info.uname=info.gname='';info.mode=0o644
  with f.open('rb') as content:tar.addfile(info,content)
 for f in sorted((ROOT/'dist').rglob('*')):
  if f.is_file():add(f,'trace-ledger-offline/dist/'+f.relative_to(ROOT/'dist').as_posix())
 add(ROOT/'serve.py','trace-ledger-offline/serve.py')
 add(ROOT/'README.md','trace-ledger-offline/README.md')
print(a.output)
