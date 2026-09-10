const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
test('refresh requests are shared only within the same session',async()=>{
 const source=fs.readFileSync('src/app/api/backend/[...path]/route.ts','utf8')+'\nexport {refreshSession};';
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const calls=[];
 const context={exports:{},require:()=>({}),process:{env:{}},AbortSignal,setTimeout,fetch:async(_url,options)=>{
   const token=JSON.parse(options.body).refresh_token;calls.push(token);
   await new Promise(resolve=>setTimeout(resolve,10));
   return {ok:true,json:async()=>({access_token:'access-'+token,refresh_token:'next-'+token,expires_in:3600})};
 }};
 vm.runInNewContext(js,context);
 const [first,second,repeated]=await Promise.all([context.exports.refreshSession('user-a'),context.exports.refreshSession('user-b'),context.exports.refreshSession('user-a')]);
 assert.equal(first.access_token,'access-user-a');assert.equal(second.access_token,'access-user-b');assert.equal(repeated.access_token,'access-user-a');
 assert.deepEqual(calls,['user-a','user-b']);
});
