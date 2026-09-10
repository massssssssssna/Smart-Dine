"""Real PostgreSQL isolation tests in a disposable localhost database."""
import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope='module')
def db():
    dsn = os.environ.get('SMARTDINE_TEST_DSN')
    if not dsn:
        pytest.skip('Set SMARTDINE_TEST_DSN to a localhost administrative test connection')
    options = psycopg.conninfo.conninfo_to_dict(dsn)
    assert options.get('host') in {'localhost', '127.0.0.1', '::1'}
    name = 'smartdine_branch_test_' + uuid4().hex[:12]
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        try:
            with psycopg.connect(**{**options, 'dbname': name}) as conn:
                for file in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
                    conn.execute(file.read_text(encoding='utf-8'))
                yield conn
                conn.rollback()
        finally:
            admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


def claims(c, actor=None, service=False, session=None):
    c.execute('RESET ROLE')
    c.execute("select set_config('app.branch_id','',true)")
    c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(
        {'role': 'service_role'} if service else {'sub': str(actor), 'role': 'authenticated', **({'session_id':str(session)} if session else {})}
    ),))
    c.execute('SET LOCAL ROLE ' + ('service_role' if service else 'authenticated'))


def owner(c):
    c.execute('RESET ROLE')
    c.execute("select set_config('request.jwt.claims','{}',true),set_config('app.branch_id','',true)")


def rpc(c, operation, data):
    return c.execute('select public.sd_command(%s,%s::jsonb,%s)', (operation,json.dumps(data),str(uuid4()))).fetchone()[0]


def read(c, resource, data=None):
    return c.execute('select public.sd_read(%s,%s::jsonb)',(resource,json.dumps(data or {}))).fetchone()[0]


def service(c, operation, data):
    claims(c,service=True)
    return c.execute('select public.sd_service(%s,%s::jsonb)',(operation,json.dumps(data))).fetchone()[0]


def denied(c, call):
    with pytest.raises(psycopg.Error):
        with c.transaction():
            call()


def make_manager(c):
    owner(c)
    uid=uuid4()
    c.execute("insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values(%s,%s,'test','{\"managed_account\":true}')",(uid,f'{uid}@example.invalid'))
    c.execute("update private.profiles set role='manager',is_active=true where id=%s",(uid,))
    return uid


def make_staff(c, manager, station='waiter'):
    uid=uuid4()
    email=f'{uid}@example.invalid'
    reservation=service(c,'reserve_user',dict(actor_id=str(manager),email=email,full_name='Test staff',role='staff',request_key=str(uuid4()),staff_type=station))
    owner(c)
    c.execute("insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values(%s,%s,'test','{\"managed_account\":true}')",(uid,email))
    service(c,'activate_user',dict(actor_id=str(manager),provision_id=reservation['id'],user_id=str(uid)))
    return uid


def test_branches_and_staff_lifecycle(db):
    c=db
    m1,m2=make_manager(c),make_manager(c)
    s1,s2=make_staff(c,m1),make_staff(c,m2)
    claims(c,m1)
    assert [x['id'] for x in read(c,'users')['items']]==[str(s1)]
    denied(c,lambda:read(c,'users',{'id':str(m1)}))
    denied(c,lambda:read(c,'users',{'id':str(s2)}))
    denied(c,lambda:c.execute('select * from private.menu_items'))
    denied(c,lambda:rpc(c,'user_update',dict(id=str(s1),expected_version=2,role='manager')))
    denied(c,lambda:rpc(c,'user_update',dict(id=str(m1),expected_version=1,role='staff')))
    claims(c,service=True)
    denied(c,lambda:service(c,'reserve_user',dict(actor_id=str(m1),email='bad@example.invalid',full_name='Bad',role='manager',request_key='bad')))
    claims(c,m1)
    dish1=rpc(c,'menu_create',dict(name='Shared name',selling_price='100'))
    ingredient=rpc(c,'ingredient_create',dict(name='Rice',unit='g'))
    claims(c,m2)
    assert read(c,'menu')['items']==[]
    dish2=rpc(c,'menu_create',dict(name='Shared name',selling_price='200'))
    assert len(read(c,'menu')['items'])==1
    denied(c,lambda:read(c,'menu',dict(id=dish1['id'])))
    denied(c,lambda:rpc(c,'menu_update',dict(id=dish1['id'],expected_version=1,selling_price='1')))
    denied(c,lambda:rpc(c,'recipe_set',dict(id=dish2['id'],expected_version=1,ingredients=[dict(ingredient_id=ingredient['id'],quantity='1')])) )
    denied(c,lambda:rpc(c,'order_create',dict(items=[dict(menu_item_id=dish1['id'],quantity=1)])))
    claims(c,s1)
    denied(c,lambda:read(c,'users'))
    order=rpc(c,'order_create',dict(items=[dict(menu_item_id=dish1['id'],quantity=1)]))
    claims(c,m2)
    assert read(c,'orders')['items']==[]
    denied(c,lambda:rpc(c,'order_transition',dict(id=order['id'],expected_version=1,status='cancelled',reason='test')))
    denied(c,lambda:c.execute('select public.sd_delete_staff(%s)',(s1,)))
    claims(c,m1)
    assert len(read(c,'orders')['items'])==1
    # Branch-specific coverage must not leak into another branch forecast.
    owner(c)
    b1=c.execute('select branch_id from private.profiles where id=%s',(m1,)).fetchone()[0]
    b2=c.execute('select branch_id from private.profiles where id=%s',(m2,)).fetchone()[0]
    assert b1!=b2
    c.execute("insert into private.daily_coverage(day,source,status,note,closed_by,branch_id) values(current_date-1,'live','complete','test',%s,%s)",(m1,b1))
    c.execute("update private.menu_items set created_at=now()-interval '7 months'")
    from datetime import date
    forecast=service(c,'forecast_input',dict(menu_item_id=dish2['id'],as_of=date.today().isoformat()))
    assert forecast['rows']==[]
    # Deletion keeps past sales, removes authentication and revokes old sessions.
    owner(c)
    session=uuid4()
    c.execute('insert into auth.sessions(id,user_id) values(%s,%s)',(session,s1))
    claims(c,m1)
    denied(c,lambda:c.execute('select public.sd_delete_staff(%s)',(m1,)))
    assert c.execute('select public.sd_delete_staff(%s)',(s1,)).fetchone()[0]['status']=='deleted'
    assert read(c,'users')['items']==[]
    assert read(c,'orders')['items'][0]['id']==order['id']
    claims(c,s1,session=session)
    denied(c,lambda:read(c,'me'))
    owner(c)
    assert c.execute('select count(*) from auth.users where id=%s',(s1,)).fetchone()[0]==0
    assert c.execute('select created_by from private.orders where id=%s',(order['id'],)).fetchone()[0] is None
    assert c.execute("select count(*) from private.audit_logs where action='staff_deleted'").fetchone()[0]==1
