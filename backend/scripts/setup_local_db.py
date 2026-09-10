"""Initialize and migrate the local PostgreSQL database for SmartDine AI."""
import os
from pathlib import Path
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]


def run_migrations(dsn: str = None):
    if not dsn:
        dsn = os.environ.get(
            "DATABASE_URL",
            "postgresql://postgres:postgres@127.0.0.1:5432/smartdine"
        )

    # Parse target database and base connection
    conninfo = psycopg.conninfo.conninfo_to_dict(dsn)
    target_db = conninfo.get("dbname", "smartdine")
    base_info = {**conninfo, "dbname": "postgres"}

    print(f"Connecting to PostgreSQL server at {conninfo.get('host', 'localhost')}:{conninfo.get('port', 5432)}...")

    with psycopg.connect(**base_info, autocommit=True) as admin_conn:
        with admin_conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
            if not cur.fetchone():
                print(f"Creating database '{target_db}'...")
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target_db)))
            else:
                print(f"Database '{target_db}' already exists.")
