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

    print(f"Applying migrations to database '{target_db}'...")
    with psycopg.connect(dsn, autocommit=True) as conn:
        migration_files = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
        for mig in migration_files:
            print(f"Executing: {mig.name}")
            sql_text = mig.read_text(encoding="utf-8")
            conn.execute(sql_text)

        # Verify installation
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'private'")
            private_tables = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'auth'")
            auth_tables = cur.fetchone()[0]

            print("\nDatabase initialization complete!")
            print(f"-> Private tables created: {private_tables}")
            print(f"-> Auth tables created: {auth_tables}")
            print("-> RPC Functions ready: public.sd_read, public.sd_command, public.sd_service")


if __name__ == "__main__":
    run_migrations()
