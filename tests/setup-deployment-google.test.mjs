import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const temporary=mkdtempSync(join(tmpdir(),'mol-bench-iam-test-'));
try {
 const bin=join(temporary,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'gcloud'),`#!/usr/bin/env python3
import sys,os,json
args=sys.argv[1:]
with open(os.environ['TEST_SETUP_LOG'],'a') as f:f.write(json.dumps(args)+'\\n')
if args[:2]==['projects','describe']:print('123456789');sys.exit(0)
if 'describe' in args and os.environ['TEST_SETUP_MODE']=='new':sys.exit(1)
if 'describe' in args and any('issuerUri' in a for a in args):print('https://wrong.example' if os.environ['TEST_SETUP_MODE']=='wrong' else 'https://token.actions.githubusercontent.com')
`,{mode:0o755});
 writeFileSync(join(bin,'curl'),`#!/usr/bin/env bash
printf '%s\\n' '{"id":1454833331,"owner":{"id":240232459},"full_name":"naonao34567890-ship-it/colabreaction_data_conductor"}'
`,{mode:0o755});
 for(const mode of ['new','existing','wrong']) {
  const log=join(temporary,mode+'.jsonl');writeFileSync(log,'');
  const result=spawnSync('bash',[fileURLToPath(new URL('../scripts/setup-deployment-google.sh',import.meta.url))],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,TEST_SETUP_LOG:log,TEST_SETUP_MODE:mode}});
  const calls=readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  if(mode==='wrong'){assert.notEqual(result.status,0);assert.ok(!calls.some(c=>c.includes('update-oidc')));continue;}
  assert.equal(result.status,0,result.stderr);
  assert.ok(result.stdout.includes('GCP_SERVICE_ACCOUNT=mol-bench-deployer@mol-bench.iam.gserviceaccount.com'));
  const provider=calls.find(c=>c.includes(mode==='new'?'create-oidc':'update-oidc'));
  const condition=provider.find(c=>c.startsWith('--attribute-condition='));
  for(const value of ['1454833331','240232459','workflow_dispatch','refs/heads/main','.github/workflows/deploy.yml'])assert.ok(condition.includes(value));
  const roles=calls.filter(c=>c.includes('add-iam-policy-binding')).flatMap(c=>c.filter(a=>a.startsWith('--role=')));
  assert.deepEqual(new Set(roles),new Set(['--role=roles/firebasehosting.admin','--role=roles/serviceusage.serviceUsageConsumer','--role=roles/iam.workloadIdentityUser']));
  assert.ok(!calls.some(c=>c.includes('keys')),'no service-account secret key is created');
 }
 console.log('PASS Google deployment setup creates/reuses the restricted provider, grants only Hosting roles and rejects an unrelated issuer');
} finally {rmSync(temporary,{recursive:true,force:true});}
