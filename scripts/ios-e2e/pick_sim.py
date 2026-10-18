#!/usr/bin/env python3
"""Prints the UDID of an available simulator: `pick_sim.py iphone` (prefers a „Pro Max“ – App Store screenshot
size 6,9") or `pick_sim.py ipad` (prefers „iPad Pro 13“). Newest iOS runtime first; empty output = none found."""
import json, re, subprocess, sys

kind = sys.argv[1] if len(sys.argv) > 1 else 'iphone'
devs = json.loads(subprocess.run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
                                 capture_output=True, text=True, check=True).stdout)['devices']


def ver(runtime):
    m = re.search(r'iOS-(\d+)-(\d+)', runtime)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


prefix, best = ('iPad', 'iPad Pro 13') if kind == 'ipad' else ('iPhone', 'Pro Max')
cands = [(ver(rt), best in d['name'], d['name'], d['udid'])
         for rt, ds in devs.items() if 'iOS' in rt for d in ds if d['name'].startswith(prefix)]
cands.sort(key=lambda c: (c[0], c[1], c[2]))
print(cands[-1][3] if cands else '')
