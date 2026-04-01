#!/usr/bin/env python3
"""
Apply 001_stealth_support_schema.sql to Supabase Postgres.
Usage:
  export SUPABASE_DB_PASSWORD='your-database-password'
  python3 scripts/run_supabase_migration.py

Password: Supabase Dashboard → Project Settings → Database → Database password
(do not commit passwords; do not use the anon API key here).
"""
import os
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("Install: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SQL_FILE = ROOT / "supabase" / "migrations" / "001_stealth_support_schema.sql"

# Project ref from SUPABASE_URL host: db.<ref>.supabase.co
PROJECT_REF = "thnwncqwplvtgszsroxh"


def main() -> None:
    password = os.environ.get("SUPABASE_DB_PASSWORD", "").strip()
    if not password:
        print(
            "Set SUPABASE_DB_PASSWORD to your Postgres password "
            "(Dashboard → Settings → Database).",
            file=sys.stderr,
        )
        sys.exit(1)

    sql = SQL_FILE.read_text(encoding="utf-8")
    conn = psycopg2.connect(
        host=f"db.{PROJECT_REF}.supabase.co",
        port=5432,
        user="postgres",
        password=password,
        dbname="postgres",
        sslmode="require",
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        print("Migration applied successfully:", SQL_FILE.name)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
