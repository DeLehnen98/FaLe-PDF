#!/bin/bash
# usage: checks.sh <sha> [annotations]
SHA=$1
R=https://api.github.com/repos/DeLehnen98/FaLe-PDF
curl -sS -H "Authorization: Bearer $GH_TOKEN" "$R/commits/$SHA/check-runs?per_page=100" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for c in d.get('check_runs',[]): print(c['id'], c['name'], c['status'], c['conclusion'])"
if [ "$2" = "ann" ]; then
  for id in $(curl -sS -H "Authorization: Bearer $GH_TOKEN" "$R/commits/$SHA/check-runs?per_page=100" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(' '.join(str(c['id']) for c in d.get('check_runs',[]) if '$3' in c['name']))"); do
    echo "=== $id"; curl -sS -H "Authorization: Bearer $GH_TOKEN" "$R/check-runs/$id/annotations?per_page=100" | python3 -c "
import json,sys
for a in json.load(sys.stdin): print('['+a['annotation_level']+']', a.get('title'), '::', (a.get('message') or '')[:3000])"
  done
fi
