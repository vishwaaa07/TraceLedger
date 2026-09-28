"""Serve packaged assets on loopback; Python standard library only."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'")
        super().end_headers()
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=4173);a=p.parse_args()
root=Path(__file__).resolve().parent/'dist'
if not (root/'index.html').exists():raise SystemExit('Built dist is missing. Use the supplied offline archive or run npm run build.')
print(f'Trace Ledger: http://127.0.0.1:{a.port}',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),partial(Handler,directory=str(root))).serve_forever()
