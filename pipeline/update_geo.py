"""Download DB-IP Lite country + ASN snapshots with provenance (online preparation).
Runtime lookup is offline. --existing verifies files already downloaded.
"""
import argparse, csv, gzip, hashlib, json, urllib.request
from pathlib import Path
from datetime import date
ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser();p.add_argument('--release',default='2026-09');p.add_argument('--existing',action='store_true');a=p.parse_args()
    import re
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',a.release):p.error('Release must be YYYY-MM')
    folder=ROOT/'public/geo';folder.mkdir(parents=True,exist_ok=True);entries=[]
    for kind in ['country','asn']:
        name=f'dbip-{kind}-lite-{a.release}.csv.gz';url=f'https://download.db-ip.com/free/{name}';path=folder/name
        if not a.existing:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://db-ip.com/'})
            with urllib.request.urlopen(req,timeout=120) as response: data=response.read()
            gzip.decompress(data) # Do not replace a good database with an error response.
            path.write_bytes(data)
        with gzip.open(path,'rt',encoding='utf-8') as f: rows=sum(1 for _ in csv.reader(f))
        entries.append({'kind':kind,'file':name,'url':url,'ranges':rows,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
    manifest={'provider':'DB-IP Lite','release':a.release,'license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/','attribution':'IP Geolocation by DB-IP','attribution_url':'https://db-ip.com','modifications':'Unmodified provider gzip CSV files. Locally indexed at runtime.','databases':entries}
    (folder/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8');print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
