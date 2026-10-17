"""Ersetzt Textstellen exakt; bricht ab, wenn die Anzahl nicht stimmt."""
import sys
def apply(path, reps):
    src = open(path, encoding="utf-8").read()
    for item in reps:
        old, new = item[0], item[1]
        cnt = item[2] if len(item) > 2 else 1
        n = src.count(old)
        if n != cnt:
            sys.exit(f"{path}: expected {cnt}x, found {n}x: {old[:90]!r}")
        src = src.replace(old, new)
    open(path, "w", encoding="utf-8").write(src)
    print(path, "ok", len(reps), "replacements")
