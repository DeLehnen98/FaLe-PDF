#!/bin/bash
# usage: gh.sh jobs RUN | ann CHECKRUN | runs
API=https://api.github.com/repos/DeLehnen98/FaLe-PDF
H=(-sS -H "Authorization: Bearer $GH_TOKEN")
case $1 in
runs) curl "${H[@]}" "$API/actions/runs?per_page=${2:-6}" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(r['id'],r['name'],r['event'],r['status'],r['conclusion'],r['head_sha'][:7]) for r in d['workflow_runs']]";;
jobs) curl "${H[@]}" "$API/actions/runs/$2/jobs" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for j in d['jobs']:
  print(j['name'], j['status'], j['conclusion'], j['check_run_url'].split('/')[-1])
  for s in j['steps']: print('  ', s['name'], s['status'], s['conclusion'])";;
ann) curl "${H[@]}" "$API/check-runs/$2/annotations?per_page=100" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for a in d: print(a['annotation_level'], '|', a['title'], '|', a['message'].replace('\n',' / ')[:${3:-3000}]); print()";;
esac
