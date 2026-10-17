"""Unit tests of the Vorlagen pack (number-to-words de/en, German holidays 2025–2030 + working days, late interest) – runs tpl_units.mjs."""
import subprocess, sys
from pathlib import Path
r = subprocess.run(['node', str(Path(__file__).parent / 'tpl_units.mjs')], capture_output=True, text=True)
print(r.stdout + r.stderr)
print('[PASS] tpl-units' if r.returncode == 0 else '[FAIL] tpl-units')
sys.exit(r.returncode)
