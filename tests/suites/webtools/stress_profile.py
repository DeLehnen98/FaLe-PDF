"""CPU profile of one tool run (to find what blocks the main thread).
  python3 stress_profile.py <tool-id> <fixture> [<fixture> …]
Prints the functions with the most self time during the run and the call stacks of the longest freeze.
"""
import collections, json, sys
from wtlib import Suite, HERE

SPECS = HERE.parents[2] / 'network' / 'tools' / 'webtools' / 'specs'
tid, files = sys.argv[1], sys.argv[2:]
spec = json.loads((SPECS / f'{tid}.json').read_text('utf-8'))
with Suite('profile') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, f"/werkzeuge/{spec['de']['slug']}/")
    s.pick(page, *files)
    s.wait_ready(page, len(files), timeout=120000)
    page.wait_for_timeout(1000)
    cdp = ctx.new_cdp_session(page)
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 500}); cdp.send('Profiler.start')
    s.primary(page).click()
    page.wait_for_selector('.wt-result:not([hidden]), .wt-error:not([hidden])', timeout=600000)
    prof = cdp.send('Profiler.stop')['profile']
    print('freeze', page.evaluate('window.__wt.freeze'))
    nodes = {n['id']: n for n in prof['nodes']}
    parent = {}
    for n in prof['nodes']:
        for c in n.get('children', []): parent[c] = n['id']
    def name(n):
        cf = n['callFrame']; return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber'] + 1}"
    self_t = collections.Counter()
    t = prof['startTime']
    # find the longest stretch of consecutive non-idle samples (= a freeze) and what ran in it
    best, cur, cur_start, stretch = 0, 0, 0, []
    best_stretch = []
    for sid, d in zip(prof['samples'], prof['timeDeltas']):
        t += d
        n = nodes[sid]
        self_t[name(n)] += d
        idle = n['callFrame']['functionName'] in ('(idle)', '(program)', '(garbage collector)') and False
        if n['callFrame']['functionName'] == '(idle)':
            if cur > best: best, best_stretch = cur, stretch
            cur, stretch = 0, []
        else:
            cur += d; stretch.append(sid)
    if cur > best: best, best_stretch = cur, stretch
    print('\nTop self time:')
    for k, v in self_t.most_common(14): print(f'  {v / 1000:8.0f} ms  {k}')
    print(f'\nLongest busy stretch ≈ {best / 1000:.0f} ms – heaviest stacks in it:')
    stacks = collections.Counter()
    for sid in best_stretch:
        chain, x = [], sid
        while x in nodes and len(chain) < 9:
            if nodes[x]['callFrame']['url']: chain.append(name(nodes[x]))
            x = parent.get(x)
        stacks[' < '.join(chain[:6])] += 1
    for k, v in stacks.most_common(8): print(f'  {v:5}  {k}')
    s.fails.clear()
