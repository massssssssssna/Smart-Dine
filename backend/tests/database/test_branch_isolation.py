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


def test_menu_deletion_preserves_history_and_permissions(db):
    c=db
    manager=make_manager(c)
    other=make_manager(c)
    staff=make_staff(c,manager)
    claims(c,manager)
    dish=rpc(c,'menu_create',dict(name='Delete test',selling_price='250'))
    claims(c,other)
    denied(c,lambda:rpc(c,'menu_delete',dict(id=dish['id'],expected_version=1)))
    claims(c,staff)
    denied(c,lambda:rpc(c,'menu_delete',dict(id=dish['id'],expected_version=1)))
    order=rpc(c,'order_create',dict(items=[dict(menu_item_id=dish['id'],quantity=1)]))
    claims(c,manager)
    denied(c,lambda:rpc(c,'menu_delete',dict(id=dish['id'],expected_version=1)))
    rpc(c,'order_transition',dict(id=order['id'],expected_version=1,status='cancelled',reason='Test cancellation'))
    denied(c,lambda:rpc(c,'menu_delete',dict(id=dish['id'],expected_version=999)))
    key=str(uuid4())
    data=json.dumps(dict(id=dish['id'],expected_version=1))
    for _ in range(2):
        assert c.execute("select public.sd_command('menu_delete',%s::jsonb,%s)",(data,key)).fetchone()[0]['status']=='deleted'
    assert read(c,'menu')['items']==[]
    denied(c,lambda:read(c,'menu',dict(id=dish['id'])))
    denied(c,lambda:rpc(c,'menu_update',dict(id=dish['id'],expected_version=2,is_active=True)))
    denied(c,lambda:rpc(c,'order_create',dict(items=[dict(menu_item_id=dish['id'],quantity=1)])))
    assert read(c,'orders')['items'][0]['items'][0]['name_snapshot']=='Delete test'
    assert rpc(c,'menu_create',dict(name='Delete test',selling_price='300'))['id']!=dish['id']


def test_simple_bottles_and_unlimited_kitchen_dishes(db):
    c=db;manager=make_manager(c);other=make_manager(c);staff=make_staff(c,manager)
    claims(c,manager)
    food=rpc(c,'menu_create',dict(name='Biryani',selling_price='450'))
    # No recipe and no kitchen ingredients are required.
    food_order=rpc(c,'order_create',dict(items=[dict(menu_item_id=food['id'],quantity=100)]))
    assert rpc(c,'order_transition',dict(id=food_order['id'],expected_version=1,status='preparing'))['status']=='preparing'
    created=rpc(c,'stock_product_create',dict(name='Pepsi 500ml',selling_price='100',quantity=24,reorder_level=5))
    stock=read(c,'stock_products')['items'][0];assert stock['stock_quantity']==24
    claims(c,other)
    assert read(c,'stock_products')['items']==[]
    denied(c,lambda:rpc(c,'stock_receive',dict(id=created['id'],quantity=1)))
    claims(c,staff)
    denied(c,lambda:rpc(c,'stock_product_create',dict(name='Bad',selling_price='10',quantity=1)))
    drink_order=rpc(c,'order_create',dict(items=[dict(menu_item_id=created['menu_item_id'],quantity=2)]))
    key=str(uuid4());transition=json.dumps(dict(id=drink_order['id'],expected_version=1,status='preparing'))
    for _ in range(2):c.execute("select public.sd_command('order_transition',%s::jsonb,%s)",(transition,key))
    claims(c,manager)
    stock=read(c,'stock_products')['items'][0];assert stock['stock_quantity']==22 and stock['used']==2
    rpc(c,'stock_receive',dict(id=created['id'],quantity=6))
    rpc(c,'stock_remove',dict(id=created['id'],quantity=1,reason='Broken bottle'))
    stock=read(c,'stock_products')['items'][0];assert stock['stock_quantity']==27 and stock['received']==30 and stock['removed']==1
    denied(c,lambda:rpc(c,'stock_receive',dict(id=created['id'],quantity=1.5)))
    oversized=rpc(c,'order_create',dict(items=[dict(menu_item_id=created['menu_item_id'],quantity=28)]))
    denied(c,lambda:rpc(c,'order_transition',dict(id=oversized['id'],expected_version=1,status='preparing')))
    assert read(c,'stock_products')['items'][0]['stock_quantity']==27


def test_cashier_permissions_payment_and_receipt(db):
    c=db;manager=make_manager(c);other_manager=make_manager(c)
    waiter=make_staff(c,manager);kitchen=make_staff(c,manager,'kitchen');cashier=make_staff(c,manager,'cashier');other=make_staff(c,other_manager,'cashier')
    claims(c,manager)
    dish=rpc(c,'menu_create',dict(name='Cashier meal',selling_price='450'))
    claims(c,waiter)
    order=rpc(c,'order_create',dict(items=[dict(menu_item_id=dish['id'],quantity=2)],discount='50',tax='20'))
    claims(c,cashier)
    for resource in ['users','menu','inventory','stock_products','expenses','analytics','audit','recipes','forecasts']:
        denied(c,lambda resource=resource:read(c,resource))
    for operation in ['order_create','order_update','order_transition','inventory_record','expense_create','menu_delete','user_update']:
        denied(c,lambda operation=operation:rpc(c,operation,dict(id=order['id'],expected_version=1,status='completed')))
    for old in ['read_core_before_cashier','read_core_before_simple_stock']:
        denied(c,lambda old=old:c.execute(f"select private.{old}('menu','{{}}')"))
    denied(c,lambda:rpc(c,'order_pay',dict(id=order['id'],expected_version=1,cash_received='1000')))
    claims(c,kitchen)
    prepared=rpc(c,'order_transition',dict(id=order['id'],expected_version=1,status='preparing'))
    ready=rpc(c,'order_transition',dict(id=order['id'],expected_version=prepared['version'],status='ready'))
    for actor in [waiter,kitchen]:
        claims(c,actor)
        denied(c,lambda:rpc(c,'order_pay',dict(id=order['id'],expected_version=ready['version'],cash_received='1000')))
        denied(c,lambda:rpc(c,'order_transition',dict(id=order['id'],expected_version=ready['version'],status='completed')))
        denied(c,lambda:read(c,'receipt',dict(id=order['id'])))
    claims(c,other)
    assert read(c,'bills')['items']==[]
    denied(c,lambda:read(c,'receipt',dict(id=order['id'])))
    denied(c,lambda:rpc(c,'order_pay',dict(id=order['id'],expected_version=ready['version'],cash_received='1000')))
    claims(c,cashier)
    receipt=read(c,'receipt',dict(id=order['id']));assert receipt['payment_status']=='unpaid' and receipt['total']=='870.00'
    assert 'ingredient_cost_snapshot' not in receipt['items'][0]
    denied(c,lambda:rpc(c,'order_pay',dict(id=order['id'],expected_version=ready['version'],cash_received='800')))
    key=str(uuid4());body=json.dumps(dict(id=order['id'],expected_version=ready['version'],cash_received='1000'))
    for _ in range(2):
        paid=c.execute("select public.sd_command('order_pay',%s::jsonb,%s)",(body,key)).fetchone()[0]
        assert paid['status']=='completed' and paid['change_given']=='130.00'
    denied(c,lambda:rpc(c,'order_pay',dict(id=order['id'],expected_version=paid['version'],cash_received='1000')))
    assert read(c,'bills')['items']==[]
    assert len(read(c,'bills',dict(payment_status='paid'))['items'])==1
    final=read(c,'receipt',dict(id=order['id']));assert final['payment_status']=='paid' and final['paid_by']==str(cashier)
    assert final['receipt_number']==receipt['receipt_number']
    claims(c,manager)
    rpc(c,'menu_update',dict(id=dish['id'],expected_version=dish['version'],selling_price='999'))
    claims(c,cashier)
    assert read(c,'receipt',dict(id=order['id']))['total']=='870.00'
    owner(c)
    assert c.execute("select count(*) from private.audit_logs where action='order_paid' and entity_id=%s",(order['id'],)).fetchone()[0]==1


def test_floors_tables_and_order_identity(db):
    c=db; manager=make_manager(c); other=make_manager(c)
    waiter=make_staff(c,manager); cashier=make_staff(c,manager,'cashier')
    claims(c,manager)
    f=rpc(c,'floor_create',dict(name='1'))
    f2=rpc(c,'floor_create',dict(name='2'))
    denied(c,lambda:rpc(c,'floor_create',dict(name='Lobby')))
    key=str(uuid4()); body=json.dumps(dict(floor_id=f['id'],name='Table 3',seats=4))
    t=c.execute("select public.sd_command('table_create',%s::jsonb,%s)",(body,key)).fetchone()[0]
    assert c.execute("select public.sd_command('table_create',%s::jsonb,%s)",(body,key)).fetchone()[0]['id']==t['id']
    denied(c,lambda:rpc(c,'floor_delete',dict(id=f['id'],expected_version=1)))
    denied(c,lambda:rpc(c,'table_create',dict(floor_id=f['id'],name='Table 3',seats=4)))
    denied(c,lambda:rpc(c,'table_create',dict(floor_id=f['id'],name='Bad',seats=0)))
    dish=rpc(c,'menu_create',dict(name='Floor meal',selling_price='100'))
    claims(c,waiter)
    assert read(c,'floors')['items'][0]['table_count']==1
    assert read(c,'tables',dict(floor_id=f['id']))['items'][0]['seats']==4
    denied(c,lambda:rpc(c,'floor_create',dict(name='Forbidden')))
    denied(c,lambda:rpc(c,'table_delete',dict(id=t['id'],expected_version=1)))
    order=rpc(c,'order_create',dict(table_id=t['id'],items=[dict(menu_item_id=dish['id'],quantity=1)]))
    assert order['table_name_snapshot']=='Table 3' and order['floor_name_snapshot']=='1'
    assert read(c,'orders',dict(q=order['order_number']))['items'][0]['id']==order['id']
    claims(c,other)
    assert read(c,'floors')['items']==[]
    assert read(c,'orders',dict(q=order['order_number']))['items']==[]
    denied(c,lambda:rpc(c,'table_create',dict(floor_id=f['id'],name='Foreign',seats=5)))
    denied(c,lambda:rpc(c,'order_create',dict(table_id=t['id'],items=[dict(menu_item_id=dish['id'],quantity=1)])))
    denied(c,lambda:c.execute('select * from private.floors'))
    claims(c,manager)
    denied(c,lambda:rpc(c,'table_delete',dict(id=t['id'],expected_version=1)))
    moved=rpc(c,'table_update',dict(id=t['id'],expected_version=1,name='Table 4',floor_id=f2['id'],seats=6))
    denied(c,lambda:rpc(c,'table_update',dict(id=t['id'],expected_version=1,name='Stale',floor_id=f2['id'],seats=5)))
    for status in ['preparing','ready']:
        order=rpc(c,'order_transition',dict(id=order['id'],expected_version=order['version'],status=status))
    claims(c,cashier)
    denied(c,lambda:read(c,'floors'))
    rpc(c,'order_pay',dict(id=order['id'],expected_version=order['version'],cash_received='100'))
    receipt=read(c,'receipt',dict(id=order['id']))
    assert receipt['receipt_number']==order['order_number'] and receipt['table_name_snapshot']=='Table 3' and receipt['seats_snapshot']==4
    claims(c,manager)
    second=rpc(c,'order_create',dict(table_id=t['id'],items=[dict(menu_item_id=dish['id'],quantity=1)]))
    assert second['order_number']!=order['order_number']
    rpc(c,'order_transition',dict(id=second['id'],expected_version=second['version'],status='cancelled',reason='Test cleanup'))
    rpc(c,'table_delete',dict(id=t['id'],expected_version=moved['version']))
    for floor in [f,f2]:rpc(c,'floor_delete',dict(id=floor['id'],expected_version=floor['version']))
    assert read(c,'floors')['items']==[]
    assert read(c,'receipt',dict(id=order['id']))['table_name_snapshot']=='Table 3'


def test_concurrent_cashiers_collect_only_once(db):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    c=db;manager=make_manager(c);a=make_staff(c,manager,'cashier');b=make_staff(c,manager,'cashier')
    claims(c,manager);dish=rpc(c,'menu_create',dict(name='Concurrent bill',selling_price='100'))
    order=rpc(c,'order_create',dict(items=[dict(menu_item_id=dish['id'],quantity=1)]))
    prepared=rpc(c,'order_transition',dict(id=order['id'],expected_version=1,status='preparing'))
    ready=rpc(c,'order_transition',dict(id=order['id'],expected_version=prepared['version'],status='ready'))
    c.commit();barrier=Barrier(2)
    def pay(actor):
        try:
            with psycopg.connect(c.info.dsn) as connection:
                claims(connection,actor);barrier.wait(timeout=10)
                rpc(connection,'order_pay',dict(id=order['id'],expected_version=ready['version'],cash_received='100'))
            return 'paid'
        except psycopg.Error as exc:
            assert exc.sqlstate=='40001'
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(pay,[a,b]))==['conflict','paid']
    owner(c)
    assert c.execute("select count(*) from private.audit_logs where action='order_paid' and entity_id=%s",(order['id'],)).fetchone()[0]==1
