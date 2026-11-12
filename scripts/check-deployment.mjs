import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export async function checkDeployment(target, commit, {fetcher=fetch, wait=ms=>new Promise(r=>setTimeout(r,ms)), attempts=6}={}) {
  if(!['worker','hosting'].includes(target))throw Error('Choose worker or hosting.');
  if(target==='hosting'&&!commit)throw Error('Hosting verification requires a commit.');
  const base=target==='worker'?'https://mol-bench-drive.naonao34567890.workers.dev/':'https://mol-bench.web.app/deployment.json';
  let failure;
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const r=await fetcher(base+'?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error('Deployment endpoint returned HTTP '+r.status);
      const state=await r.json();
      if(target==='worker'&&(!state.configured||!state.libraryConfigured))throw Error('Worker bindings or secrets are incomplete.');
      const actual=target==='worker'?state.deploymentCommit:state.commit;
      if(commit&&actual!==commit)throw Error('Expected source revision is not visible yet.');
      return state;
    }catch(error){failure=error;}
    if(attempt+1<attempts)await wait(2000);
  }
  throw Error(target+' deployment was not verified: '+failure.message);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await checkDeployment(process.argv[2],process.argv[3]);
  console.log(process.argv[2]+' deployment verified.');
}
