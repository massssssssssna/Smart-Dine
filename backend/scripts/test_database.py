"""Replay and test migrations in a new disposable database on localhost only."""
import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

ROOT = Path(__file__).resolve().parents[2]


def main():
    dsn = os.environ.get("SMARTDINE_TEST_DSN", "host=127.0.0.1 port=5432 user=postgres password=postgres dbname=postgres")
    options = conninfo_to_dict(dsn)
    if options.get("host") not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Refusing non-local test database. This harness never tests against hosted Supabase.")
    name = "smartdine_test_" + uuid4().hex[:12]
    admin = psycopg.connect(dsn, autocommit=True)
    created = False
    try:
        admin.execute(sql.SQL("CREATE DATABASE {} ").format(sql.Identifier(name)))
        created = True
        with psycopg.connect(**{**options, "dbname": name}, autocommit=True) as conn:
            conn.execute((ROOT / "supabase/tests/local_auth_shim.sql").read_text(encoding="utf-8"))
            for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                conn.execute(migration.read_text(encoding="utf-8"))
                print(f"Migration replayed: {migration.name}")
            for test in sorted((ROOT / "supabase/tests").glob("*_invariants.sql")):
                conn.execute(test.read_text(encoding="utf-8"))
                print(f"PASS: {test.name}")
            from database_scenarios import run_concurrency, run_scenarios
            run_scenarios(conn)
            run_concurrency({**options, "dbname": name})
            info = conn.execute("select count(*) from pg_tables where schemaname='private'").fetchone()
            print(json.dumps({"status": "passed", "private_tables": info[0],
                              "auth_scope": "SQL shim only; real GoTrue checked separately"}))
    finally:
        if created:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        admin.close()
