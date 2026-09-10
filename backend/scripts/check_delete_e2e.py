"""Exercise the running frontend proxy and API in a temporary local test branch."""
import json
from pathlib import Path
import sys
import time
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
import jwt
import psycopg
from psycopg import sql
from app.core.config import get_settings


def main():
    settings=get_settings()
    dsn=settings.database_url.get_secret_value()
    assert psycopg.conninfo.conninfo_to_dict(dsn).get('host') in {'127.0.0.1','localhost','::1'}, 'Local database only'
    manager=uuid4();session=uuid4();branch=None;auth_ids=[manager]
    try:
        with psycopg.connect(dsn) as c:
            c.execute("insert into auth.users(id,email,encrypted_password,raw_app_meta_data,raw_user_meta_data) values(%s,%s,'unusable-test-password','{\"managed_account\":true}','{\"full_name\":\"Temporary delete test\"}')",(manager,f'{manager}@example.invalid'))
            c.execute("update private.profiles set role='manager',is_active=true where id=%s",(manager,))
            branch=c.execute('select branch_id from private.profiles where id=%s',(manager,)).fetchone()[0]
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)',(session,manager))
        token=jwt.encode({'sub':str(manager),'role':'manager','session_id':str(session),'exp':int(time.time())+300},settings.jwt_secret_key.get_secret_value(),algorithm='HS256')
        with httpx.Client(base_url='http://127.0.0.1:3000/api/backend/',cookies={'sd_access':token},headers={'Origin':'http://127.0.0.1:3000'},timeout=60) as client:
            def request(method,path,body=None,expected=200):
                response=client.request(method,path,json=body,headers={'Idempotency-Key':str(uuid4())})
                assert response.status_code==expected,(method,path,response.status_code,response.text)
                return response.json()
            staff=request('POST','users',{'email':f'{uuid4()}@example.com','full_name':'Delete test staff','password':str(uuid4()),'role':'staff','staff_type':'waiter'},201)
            auth_ids.append(staff['id'])
            request('DELETE','users/'+staff['id'])
            assert request('GET','users')['items']==[]
            dish=request('POST','menu',{'name':'Delete test dish','category':'Test','selling_price':'100'},201)
            request('DELETE','menu/'+dish['id'],{'expected_version':dish['version']})
            assert request('GET','menu')['items']==[]
            request('POST','inventory/products',{'name':'Delete test drink','selling_price':'100','quantity':12},201)
            drink=request('GET','inventory/products')['items'][0]
            menu_item=request('GET','menu/'+drink['menu_item_id'])
            request('DELETE','menu/'+drink['menu_item_id'],{'expected_version':menu_item['version']})
            assert request('GET','inventory/products')['items']==[]
            assert request('GET','menu')['items']==[]
            print('PASS: real frontend -> API -> database deletes for staff, menu and drinks; refreshed lists are empty.')
    finally:
        if branch:
            with psycopg.connect(dsn) as c:
                auth_ids += [row[0] for row in c.execute('select id from private.profiles where branch_id=%s',(branch,)).fetchall()]
                for table in ['inventory_transactions','audit_logs','idempotency_records','menu_items','ingredients','user_provisioning']:
                    c.execute(sql.SQL('delete from private.{} where branch_id=%s').format(sql.Identifier(table)),(branch,))
                c.execute('delete from auth.sessions where user_id=any(%s::uuid[])',([str(x) for x in auth_ids],))
                c.execute('delete from private.profiles where branch_id=%s',(branch,))
                c.execute('delete from private.branches where id=%s',(branch,))
                c.execute('delete from auth.users where id=any(%s::uuid[])',([str(x) for x in auth_ids],))
            print('Temporary test branch and accounts removed. Existing restaurant data was not changed.')
