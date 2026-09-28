#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3,10))' 2>/dev/null; then
  echo "Install Python 3.10 or newer, then run: sh START_LINUX.sh"
  exit 1
fi
echo "Open http://127.0.0.1:4173 in your browser. Keep this terminal open."
exec python3 serve.py
