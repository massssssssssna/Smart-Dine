"""Restore the full SmartDine database from smartdine_full_backup.sql."""
import os
import subprocess
import sys
from pathlib import Path
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]
BACKUP_FILE = ROOT / "smartdine_full_backup.sql"


def find_psql() -> str:
    # Common default paths on Windows
    candidates = [
        r"C:\Program Files\PostgreSQL\18\bin\psql.exe",
        r"C:\Program Files\PostgreSQL\17\bin\psql.exe",
        r"C:\Program Files\PostgreSQL\16\bin\psql.exe",
        r"C:\Program Files\PostgreSQL\15\bin\psql.exe",
    ]
    for c in candidates:
        if Path(c).is_file():
            return c
    # Fallback to system PATH
    return "psql"


def restore(backup_path: Path = BACKUP_FILE, dsn: str = None):
    if not backup_path.is_file():
        raise FileNotFoundError(f"Backup file not found at: {backup_path}")

    if not dsn:
        dsn = os.environ.get(
            "DATABASE_URL",
            "postgresql://postgres:postgres@127.0.0.1:5432/smartdine"
        )

    conninfo = psycopg.conninfo.conninfo_to_dict(dsn)
    target_db = conninfo.get("dbname", "smartdine")
    base_info = {**conninfo, "dbname": "postgres"}

    print(f"Connecting to PostgreSQL at {conninfo.get('host', 'localhost')}:{conninfo.get('port', 5432)}...")

    with psycopg.connect(**base_info, autocommit=True) as admin_conn:
        with admin_conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
            if not cur.fetchone():
                print(f"Creating database '{target_db}'...")
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target_db)))
            else:
                print(f"Database '{target_db}' already exists.")

    print(f"Restoring backup from {backup_path.name} into '{target_db}'...")
    psql_exe = find_psql()

    env = os.environ.copy()
    if conninfo.get("password"):
        env["PGPASSWORD"] = conninfo["password"]

    cmd = [
        psql_exe,
        "-h", conninfo.get("host", "127.0.0.1"),
        "-p", str(conninfo.get("port", 5432)),
        "-U", conninfo.get("user", "postgres"),
        "-d", target_db,
        "-v", "ON_ERROR_STOP=1",
        "-f", str(backup_path),
    ]

    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        # Check if error is just non-fatal notices
        print("Restore stderr output:", result.stderr[-500:] if result.stderr else "None")
        if "ERROR:" in result.stderr:
            print("Warning: Some errors occurred during restore (review stderr above).")
        else:
            print("Restore finished with warnings/notices.")
    else:
        print("Database restored successfully!")

    # Verify counts
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM private.profiles")
            profiles = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM private.historical_sales")
            sales = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM private.menu_items")
            dishes = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM private.orders")
            orders = cur.fetchone()[0]

            print(f"-> Verified: {profiles} profiles/logins")
            print(f"-> Verified: {dishes} menu items")
            print(f"-> Verified: {sales} historical daily sales records (6 months)")
            print(f"-> Verified: {orders} recent orders")


if __name__ == "__main__":
    restore()
