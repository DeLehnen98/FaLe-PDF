"""Failed veraPDF rules from its JSON report on stdin, one line (for CI annotations)."""
import json
import sys

try:
    data = json.load(sys.stdin)
except Exception as e:  # noqa: BLE001
    print('no JSON report:', e)
    sys.exit()
out = []


def walk(o):
    if isinstance(o, dict):
        if 'clause' in o and 'description' in o and o.get('status', 'failed') != 'passed':
            out.append('%s %s-%s: %s (%sx)' % (o.get('specification', ''), o['clause'], o.get('testNumber'), o['description'], o.get('failedChecks', '?')))
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


walk(data)
print(' | '.join(sorted(set(out)))[:3000])
