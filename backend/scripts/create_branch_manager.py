"""Owner-only, interactive local database provisioning; never exposed by the API."""
from getpass import getpass
from pathlib import Path
import json
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bcrypt
import psycopg
from app.core.config import get_settings


def main():
    email = input('New branch manager email: ').strip().lower()
    name = input('Manager full name: ').strip()
    branch = input('Branch name: ').strip()
    password = getpass('Password (12+ characters): ')
    if '@' not in email or not name or not branch or len(password)<12 or password!=getpass('Confirm password: '):
        raise SystemExit('Check email, names and matching passwords (12+ characters).')
    uid=uuid4()
    with psycopg.connect(get_settings().database_url.get_secret_value()) as conn:
        conn.execute("INSERT INTO auth.users(id,email,encrypted_password,raw_app_meta_data,raw_user_meta_data) VALUES(%s,%s,%s,%s::jsonb,%s::jsonb)",
                     (uid,email,bcrypt.hashpw(password.encode(),bcrypt.gensalt(12)).decode(),json.dumps({'managed_account':True}),json.dumps({'full_name':name})))
        conn.execute("UPDATE private.profiles SET role='manager',is_active=true WHERE id=%s",(uid,))
        conn.execute("UPDATE private.branches SET name=%s WHERE id=(SELECT branch_id FROM private.profiles WHERE id=%s)",(branch,uid))
    print('Manager created with an independent, empty branch.')


if __name__=='__main__':
    main()
