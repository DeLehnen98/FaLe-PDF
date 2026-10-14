#!/usr/bin/env python3
"""Apply pending supabase/migrations/*.sql through the Supabase Management API.

Used by .github/workflows/db-migrate.yml when the secret SUPABASE_ACCESS_TOKEN is set
(personal access token from supabase.com/dashboard/account/tokens). No database password
and no IPv4/IPv6 pooler juggling needed. Each file runs as ONE query string, which Postgres
executes in a single implicit transaction; the file name is recorded in
private.fale_migrations in that same transaction, so a file is applied exactly once.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
REF = os.environ.get('SUPABASE_PROJECT_REF', '').strip()
ROOT = pathlib.Path(__file__).resolve().parent.parent / 'supabase' / 'migrations'


def query(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json',
                 'User-Agent': 'fale-db-migrate'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read().decode() or 'null'
            return json.loads(body)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')[:1500]
        raise RuntimeError(f'HTTP {e.code}: {detail}') from None


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    if not TOKEN or not REF:
        print('::error title=DB migrate::SUPABASE_ACCESS_TOKEN oder SUPABASE_PROJECT_REF fehlt'); return 1
    print('::add-mask::' + TOKEN)
    query("create schema if not exists private; "
          "create table if not exists private.fale_migrations (name text primary key, applied_at timestamptz not null default now()); "
          "revoke all on private.fale_migrations from public;")
    base = ROOT / '.baseline'
    if base.exists():
        for b in base.read_text().split():
            query(f"insert into private.fale_migrations(name) values ({lit(b)}) on conflict do nothing;")
    rows = query('select name from private.fale_migrations;') or []
    done = {r['name'] for r in rows}
    applied = 0
    for f in sorted(ROOT.glob('*.sql')):
        if f.name in done:
            print(f'✓ {f.name} (bereits angewendet)'); continue
        print(f'→ {f.name}', flush=True)
        sql = f.read_text()
        try:
            query(sql.rstrip().rstrip(';') + f";\ninsert into private.fale_migrations(name) values ({lit(f.name)});")
        except RuntimeError as e:
            msg = str(e).replace('%', '%25').replace('\n', '%0A')
            print(f'::error title=Migration {f.name} fehlgeschlagen::{msg}'); return 1
        applied += 1
    print(f'::notice title=DB migrate::{applied} neue Migration(en) angewendet (Management API).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
