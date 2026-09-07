import {runInit,renderRepoRule} from '../../src/cli/init.ts';
import {initGitRepo,tempDir,removeDir,readRequest,mutRequest,gitHead} from '../../tests/support/harness.ts';
import {setupFlow,flowCreate,flowClaim,flowSubmit} from '../../tests/support/flow.ts';
const a=initGitRepo(), b=initGitRepo(), home=tempDir('lore-audit-home-'),userHome=tempDir('lore-audit-user-');
const opts={root:a,home,name:'First',agents:[{id:'codex',role:'implement'},{id:'grok',role:'review'}],writeRules:false,writeUserRules:false,demo:false,json:true,detect:false};
try {
 const first=await runInit(opts,{PATH:'',LOREFORGE_HOME:home},{userHome,execPath:'lore'});
 for (const [scenario,next] of [['second-project',{...opts,root:b,name:'Second'}],['change-role',{...opts,agents:[{id:'codex',role:'both'},{id:'grok',role:'review'}]}]]) {
  try {await runInit(next,{PATH:'',LOREFORGE_HOME:home},{userHome,execPath:'lore'});console.log(JSON.stringify({scenario,ok:true}));}
  catch(e){console.log(JSON.stringify({scenario,ok:false,error:e.message}));}
 }
 console.log(JSON.stringify({scenario:'installed-rule-policy',rule:renderRepoRule({execPath:'lore',homeDir:home,projectId:first.projectId,roster:opts.agents})}));
}finally{removeDir(a);removeDir(b);removeDir(home);removeDir(userHome);}
const env=await setupFlow();
try {
 const prior=await flowCreate(env,'muse','older-task');const c=await flowClaim(env,'muse','older-claim',prior.id);
 await flowSubmit(env,'muse','older-done',prior.id,c.claimToken,{summary:'Found why cache becomes stale; reusable discovery'});
 const next=await flowCreate(env,'flash','new-independent-task');
 const context=await env.held.core.execute(readRequest('context.get',env.projectId,{taskId:next.id,mode:'work'}));
 console.log(JSON.stringify({scenario:'unlinked-prior-work',previousTaskCompleted:true,handoffsInNewContext:context.ok?context.data.snapshot.handoffs.length:null}));
 const review=await flowCreate(env,'flash','review-task',[prior.id]);
 const handoff=await env.held.core.execute(mutRequest('handoff.submit',env.projectId,'flash','review-result',{taskId:review.id,claimToken:'no-claim-per-review-rule',outcome:'completed',summary:'Reviewed change; no problems',evidence:{checkoutRoot:env.repo,head:gitHead(env.repo),dirty:false,files:[],checks:[]},unresolved:[],nextSteps:[],blockingQuestionIds:[]}));
 console.log(JSON.stringify({scenario:'reviewer-following-no-claim-rule',ok:handoff.ok,error:handoff.ok?null:handoff.error.code}));
}finally{env.cleanup();}
