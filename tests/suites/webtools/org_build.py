"""Local test build (agent org): like network/tools/webtools/build.py, but unknown related/next ids
(tools other agents have not added yet) are ignored instead of aborting. Never used for the real build."""
import sys, subprocess
P = '/home/claude/FalePDF/network/tools/webtools/build.py'
subprocess.run([sys.executable, '/home/claude/FalePDF/network/tools/build_pages.py'], check=True, stdout=subprocess.DEVNULL)
src = open(P).read().replace("errors.append(f'{sp[\"id\"]}.json: {k} references unknown tool \"{rid}\"')", "pass")
assert src.count('pass') >= 1
g = {'__file__': P, '__name__': '__main__'}
exec(compile(src, P, 'exec'), g)
