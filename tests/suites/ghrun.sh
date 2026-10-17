#!/bin/bash
# usage: ghrun.sh <workflow-file> -> waits for latest run, prints annotations
R=DeLehnen98/FaLe-PDF; W=$1
H=(-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json")
for i in $(seq 1 60); do
  J=$(curl -s "${H[@]}" "https://api.github.com/repos/$R/actions/workflows/$W/runs?per_page=1")
  ID=$(echo "$J" | python3 -c 'import json,sys;r=json.load(sys.stdin)["workflow_runs"][0];print(r["id"],r["status"],r["conclusion"],r["head_sha"][:7])')
  set -- $ID
  [ "$2" = completed ] && break
  sleep 10
done
echo "run $ID"
curl -s "${H[@]}" "https://api.github.com/repos/$R/actions/runs/$1/jobs" | python3 -c 'import json,sys;[print(j["id"],j["name"],j["conclusion"]) for j in json.load(sys.stdin)["jobs"]]' | while read JID NAME C; do
  echo "== job $NAME $C"
  curl -s "${H[@]}" "https://api.github.com/repos/$R/check-runs/$JID/annotations?per_page=100" | python3 -c 'import json,sys;[print("[%s] %s: %s" % (a["annotation_level"],a["title"],a["message"])) for a in json.load(sys.stdin)]'
done
