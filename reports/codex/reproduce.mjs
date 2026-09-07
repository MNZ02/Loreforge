import { spawn } from 'node:child_process';
import { openCore } from '/Users/mnz/dev/agent-company/src/core/index.ts';
import { setupFlow, flowCreate, flowClaim } from '/Users/mnz/dev/agent-company/tests/support/flow.ts';
import { initGitRepo, gitCommitFile, gitHead, removeDir, mutRequest } from '/Users/mnz/dev/agent-company/tests/support/harness.ts';

const foreign = initGitRepo();
const env = await setupFlow();
try {
  gitCommitFile(foreign, 'foreign.txt', 'different project\n', 'foreign change');
  const task = await flowCreate(env, 'muse', 'wrong-repo-task');
  const claim = await flowClaim(env, 'muse', 'wrong-repo-claim', task.id);
  const response = await env.held.core.execute(mutRequest('handoff.submit',env.projectId,'muse','wrong-repo-handoff',{
    taskId:task.id,claimToken:claim.claimToken,outcome:'completed',summary:'Wrong repository evidence',
    evidence:{checkoutRoot:foreign,head:gitHead(foreign),dirty:false,files:[],checks:[]},unresolved:[],nextSteps:[],blockingQuestionIds:[]
  }));
  console.log(JSON.stringify({scenario:'foreign-checkout',registeredRoot:env.repo,submittedRoot:foreign,accepted:response.ok,taskStatus:response.ok?response.data.task.status:response.error.code}));
} finally {env.cleanup();removeDir(foreign);}

let offset = 0;
const leased = await setupFlow(()=>Date.now()+offset);
let holder;
try {
  const task = await flowCreate(leased, 'muse', 'lease-task');
  offset = -2*60*60*1000 + 1500;
  const claim = await flowClaim(leased,'muse','lease-claim',task.id);
  offset = 0;
  const expires=Date.parse(claim.task.leaseUntil);
  holder=spawn(process.execPath,['--input-type=module','-e',`import { DatabaseSync } from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('READY');setTimeout(()=>{db.exec('COMMIT');db.close()},2500);`, leased.held.home+'/company.sqlite3'],{stdio:['ignore','pipe','pipe']});
  const done=new Promise((resolve,reject)=>{holder.on('close',resolve);holder.on('error',reject)});
  await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject)});
  const began=Date.now();
  const response=await leased.held.core.execute(mutRequest('task.renew',leased.projectId,'muse','lease-renew',{taskId:task.id,claimToken:claim.claimToken}));
  const finished=Date.now();
  console.log(JSON.stringify({scenario:'renew-after-lock-wait',startedBeforeExpiryMs:expires-began,finishedAfterExpiryMs:finished-expires,accepted:response.ok,result:response.ok?'renewed':response.error.code}));
  await done;
} finally {holder?.kill();leased.cleanup();}

const fs = await import('node:fs');
const path = await import('node:path');
const crypto = await import('node:crypto');
const gitEvidence = await import('/Users/mnz/dev/agent-company/src/evidence/git.ts');
const schemas = await import('/Users/mnz/dev/agent-company/src/core/schemas/handoffs.ts');
const indexRepo = initGitRepo();
try {
  const index=path.join(indexRepo,'.git/index');
  const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(index)).digest('hex');
  const before=hash();
  const f=path.join(indexRepo,'file.txt');const st=fs.statSync(f);
  fs.utimesSync(f,st.atime,new Date(st.mtimeMs-10000));
  const observed=gitEvidence.observeCheckout(indexRepo,Date.now());
  console.log(JSON.stringify({scenario:'read-only-index',indexChanged:before!==hash(),reportedDirty:observed.dirty}));
} finally {removeDir(indexRepo);}
const doc=fs.readFileSync('/Users/mnz/dev/agent-company/examples/two-agent/README.md','utf8');
const result=schemas.EvidenceInputSchema.safeParse({checkoutRoot:'/tmp/fixture',head:'a'.repeat(40),dirty:false,files:[{path:'math.js',change:'modified'},{'math.test.js':'modified',path:'math.test.js',change:'modified'}],checks:[]});
console.log(JSON.stringify({scenario:'S1-published-file-entry',publishedEntryPresent:doc.includes('{ "math.test.js": "modified", "path": "math.test.js", "change": "modified" }'),schemaAccepted:result.success,issues:result.error?.issues.map(x=>({code:x.code,path:x.path,keys:x.keys}))}));
// This is a diagnostic: inspect observations, not exit 0, to determine a fix.
