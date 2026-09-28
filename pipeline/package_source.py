"""Create a portable source archive, excluding installed dependencies and scratch outputs."""
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
target=root.parent/'ltraceledger.zip'
skip={'.git','node_modules','.venv','__pycache__','test-results','playwright-report','.netlify','generated'}
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(root.rglob('*')):
  if not p.is_file() or set(p.relative_to(root).parts)&skip:
   continue
  rel=p.relative_to(root).as_posix()
  if rel.startswith('docs/screenshots/') or p.name in {'browser-results.json','offline-browser-evidence.json'}:
   continue
  if p.name.startswith('.env') or p.suffix in {'.pem','.key'}:
   continue
  z.write(p,'ltraceledger/'+rel)
print(target)

