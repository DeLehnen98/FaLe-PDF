from rep import apply
apply("/home/claude/FaLeClean/fale_i18n.py", [
('''def _value(v: str) -> str:
    """Eingesetzte Werte: bekannte Begriffe übersetzen, deutsche Dezimalzahlen umstellen."""
    if v in EN:
        return EN[v]
    m = _DE_NUM.match(v)
    if m:
        return f"{m.group(1)}.{m.group(2)}{m.group(3) or ''}"
    if ", " in v:
        parts = v.split(", ")
        if any(p in EN for p in parts):
            return ", ".join(EN.get(p, p) for p in parts)
    return v''',
'''def _value(v: str) -> str:
    """Eingesetzte Werte: bekannte Begriffe übersetzen, deutsche Dezimalzahlen umstellen."""
    if v in EN:
        return EN[v]
    m = _DE_NUM.match(v)
    if m:
        return f"{m.group(1)}.{m.group(2)}{m.group(3) or ''}"
    if ", " in v:
        parts = v.split(", ")
        if any(p in EN for p in parts):
            return ", ".join(EN.get(p, p) for p in parts)
    return session_label(v)


_SESSION = re.compile(r"Reinigung (\\d\\d)\\.(\\d\\d)\\.(\\d{4}) (\\d\\d:\\d\\d)")


def session_label(label: str) -> str:
    """Name eines Quarantäne-Vorgangs ("Reinigung 13.10.2026 14:00", "Reste von X") übersetzen."""
    m = _SESSION.fullmatch(label)
    if m:
        d, mo, y, hm = m.groups()
        return tr("Reinigung {date}", date=f"{mo}/{d}/{y} {hm}" if lang() == "en" else f"{d}.{mo}.{y} {hm}")
    return tr_any(label)'''),
])
apply("/home/claude/FaLeClean/falecore.py", [
('''def q_label(label: str) -> str:
    """Name eines Quarantäne-Vorgangs in der aktiven Sprache (gespeichert wird deutsch)."""
    m = re.fullmatch(r"Reinigung (\\d\\d)\\.(\\d\\d)\\.(\\d{4}) (\\d\\d:\\d\\d)", label)
    if m:
        d, mo, y, hm = m.groups()
        return tr("Reinigung {date}", date=f"{mo}/{d}/{y} {hm}" if i18n.lang() == "en" else f"{d}.{mo}.{y} {hm}")
    return tr_any(label)''',
'''def q_label(label: str) -> str:
    """Name eines Quarantäne-Vorgangs in der aktiven Sprache (gespeichert wird deutsch)."""
    return i18n.session_label(label)'''),
])
