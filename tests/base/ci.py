import json, os, sys, time, urllib.request
R = 'DeLehnen98/FaLe-PDF'
def api(path):
    req = urllib.request.Request(f'https://api.github.com/repos/{R}/{path}', headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
    return json.load(urllib.request.urlopen(req, timeout=30))
sha = sys.argv[1] if len(sys.argv) > 1 else None
deadline = time.time() + float(sys.argv[2] if len(sys.argv) > 2 else 560)
while True:
    runs = api('actions/runs?per_page=5')['workflow_runs']
    run = next((r for r in runs if not sha or r['head_sha'].startswith(sha)), None)
    if run and run['status'] == 'completed': break
    if time.time() > deadline: print('still running', run and run['status']); sys.exit(2)
    time.sleep(20)
print('RUN', run['id'], run['conclusion'])
for j in api(f"actions/runs/{run['id']}/jobs")['jobs']:
    bad = [s['name'] for s in j['steps'] if s['conclusion'] == 'failure']
    print('JOB', j['name'], j['conclusion'], 'failed steps:', bad)
    for a in api(f"check-runs/{j['id']}/annotations"):
        if a['annotation_level'] == 'failure': print(a['title'], '\n', a['message'][:12000])
