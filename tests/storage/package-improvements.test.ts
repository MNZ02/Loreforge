import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, readFileSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setupFlow, flowCreate, flowClaim, flowSubmit } from "../support/flow.js";
import { execOk, execErr, mutRequest, readRequest, tempDir, removeDir, gitHead } from "../support/harness.js";
import type { NoteRecord, SearchQueryData, TaskListData, ExtensionData } from "../../src/core/contracts.js";
import { backupState, restoreState, exportState } from "../../src/storage/maintenance.js";
import { openCore } from "../../src/core/index.js";
import { resolveDbPath } from "../../src/storage/db.js";
import { observeCheckout } from "../../src/evidence/git.js";
import { makeExcerpt } from "../../src/storage/search-text.js";

const notePayload = (changes: Record<string, unknown> = {}) => ({title:"Needle",finding:"needle",reason:"Evidence",evidenceRefs:[],paths:["other/file.ts"],observedCommit:null,status:"proposed",taskId:null,supersedesId:null,...changes});

describe("package review regressions", () => {
  it("filters before ranking limits, normalizes paths, and counts all omitted eligible hits", async () => {
    const env=await setupFlow();
    try {
      const target=await execOk<{note:NoteRecord}>(env.held.core,mutRequest("note.add",env.projectId,"muse","target",notePayload({title:"Target",finding:"needle "+"padding ".repeat(400),paths:["./src/target.ts"]})));
      for(let i=0;i<501;i++) await execOk(env.held.core,mutRequest("note.add",env.projectId,"muse",`noise-${i}`,notePayload()));
      for(const path of ["src","src/","./src"]) {
        const result=await execOk<SearchQueryData>(env.held.core,readRequest("search.query",env.projectId,{query:"needle",files:[path]}));
        assert.deepEqual(result.hits.map(h=>h.id),[target.note.id]); assert.equal(result.omittedCount,0);
      }
      const all=await execOk<SearchQueryData>(env.held.core,readRequest("search.query",env.projectId,{query:"needle",limit:5}));
      assert.equal(all.omittedCount,497);
      assert.ok(makeExcerpt("x".repeat(300)+" needle "+"y".repeat(300),["needle"]).length<=240);
    } finally {env.cleanup();}
  });

  it("returns correction history, task/decision hits and evidence freshness", async () => {
    const env=await setupFlow();
    try {
      const add=async(id:string,changes:Record<string,unknown>)=>(await execOk<{note:NoteRecord}>(env.held.core,mutRequest("note.add",env.projectId,"muse",id,notePayload(changes)))).note;
      const old=await add("old",{observedCommit:gitHead(env.repo)});
      const next=await add("next",{supersedesId:old.id,observedCommit:gitHead(env.repo)});
      const latest=await add("latest",{supersedesId:next.id,observedCommit:gitHead(env.repo)});
      const page=await execOk<ExtensionData>(env.held.core,readRequest("note.history",env.projectId,{noteId:next.id,limit:2}));
      assert.deepEqual(page.history!.map(n=>n.id),[old.id,next.id]);assert.equal(page.nextAfter,next.id);
      const last=await execOk<ExtensionData>(env.held.core,readRequest("note.history",env.projectId,{noteId:old.id,after:page.nextAfter}));assert.deepEqual(last.history!.map(n=>n.id),[latest.id]);
      const hits=await execOk<SearchQueryData>(env.held.core,readRequest("search.query",env.projectId,{query:"needle",currentCommit:gitHead(env.repo)}));assert.equal(hits.hits[0].freshness,"current_commit");
      await flowCreate(env,"muse","discoverablekeyword");
      await execOk(env.held.core,mutRequest("decision.record",env.projectId,"muse","decision",{body:"discoverablekeyword choice",paths:[],supersedesId:null}));
      const discovered=await execOk<SearchQueryData>(env.held.core,readRequest("search.query",env.projectId,{query:"discoverablekeyword"}));assert.deepEqual(new Set(discovered.hits.map(h=>h.source)),new Set(["task","decision"]));
    } finally {env.cleanup();}
  });

  it("paginates equal-timestamp tasks and reports expiry/dependency blockers", async () => {
    let now=100000;const env=await setupFlow(()=>now);
    try {
      const ids=[];for(let i=0;i<105;i++)ids.push((await flowCreate(env,"muse",`page-${i}`)).id);
      const first=await execOk<TaskListData>(env.held.core,readRequest("task.list",env.projectId,{limit:100}));
      const second=await execOk<TaskListData>(env.held.core,readRequest("task.list",env.projectId,{limit:100,cursor:first.nextCursor}));
      assert.equal(new Set([...first.tasks,...second.tasks].map(t=>t.id)).size,105);assert.equal(second.nextCursor,null);
      assert.equal((await execErr(env.held.core,readRequest("task.list",env.projectId,{status:"open",cursor:first.nextCursor}))).code,"VALIDATION");
      const blocked=await flowCreate(env,"muse","blocked",[ids[0]]);await flowClaim(env,"muse","claim",ids[0]);now+=7200001;
      const expired=await execOk<TaskListData>(env.held.core,readRequest("task.list",env.projectId,{expired:true}));assert.deepEqual(expired.tasks.map(t=>t.id),[ids[0]]);assert.equal(expired.availability![ids[0]].claimable,true);
      const eligible=await execOk<TaskListData>(env.held.core,readRequest("task.list",env.projectId,{claimable:true,limit:100}));assert.ok(!eligible.tasks.some(t=>t.id===blocked.id));
      const blockedList=await execOk<TaskListData>(env.held.core,readRequest("task.list",env.projectId,{claimable:false}));assert.deepEqual(blockedList.availability![blocked.id].blockedBy,[ids[0]]);
    } finally {env.cleanup();}
  });

  it("records an idempotent review bound to a handoff commit without an editing claim", async () => {
    const env=await setupFlow();const other=await setupFlow();
    try {
      const task=await flowCreate(env,"muse","review-task"),claim=await flowClaim(env,"muse","review-claim",task.id);
      const {handoff}=await flowSubmit(env,"muse","review-handoff",task.id,claim.claimToken);
      const payload={handoffId:handoff.id,observedCommit:handoff.observed.head,outcome:"approved",body:"Verified behavior"};
      const request=mutRequest("review.record",env.projectId,"flash","review-record",payload);
      const first=await execOk<ExtensionData>(env.held.core,request);assert.deepEqual(await execOk(env.held.core,request),first);assert.equal(first.review!.attempt,1);
      assert.equal((await execErr(env.held.core,mutRequest("review.record",env.projectId,"flash","bad-commit",{...payload,observedCommit:"f".repeat(40)}))).code,"CONFLICT");
      assert.equal((await execErr(other.held.core,mutRequest("review.record",other.projectId,"flash","foreign",payload))).code,"NOT_FOUND");
      const list=await execOk<ExtensionData>(env.held.core,readRequest("review.list",env.projectId,{handoffId:handoff.id}));assert.equal(list.reviews!.length,1);
    } finally {env.cleanup();other.cleanup();}
  });

  it("indexes handoff checks and rebuilds missing derived documents", async () => {
    const env=await setupFlow();
    try {
      const task=await flowCreate(env,"muse","index-task"),claim=await flowClaim(env,"muse","index-claim",task.id);
      const {handoff}=await flowSubmit(env,"muse","index-handoff",task.id,claim.claimToken);
      const hits=await execOk<SearchQueryData>(env.held.core,readRequest("search.query",env.projectId,{query:"green",sources:["handoff"]}));assert.equal(hits.hits[0].id,handoff.id);
      const raw=new DatabaseSync(resolveDbPath(env.held.home));raw.prepare("DELETE FROM search_docs WHERE entity_id = ?").run(handoff.id);raw.close();
      const bad=await execOk<ExtensionData>(env.held.core,readRequest("index.check",env.projectId,{}));assert.equal(bad.index!.healthy,false);
      const fixed=await execOk<ExtensionData>(env.held.core,mutRequest("index.rebuild",env.projectId,"muse","rebuild",{}));assert.equal(fixed.index!.healthy,true);
      const repaired=await execOk<SearchQueryData>(env.held.core,readRequest("search.query",env.projectId,{query:"green"}));assert.equal(repaired.hits[0].id,handoff.id);
    } finally {env.cleanup();}
  });

  it("backs up committed WAL records, refuses overwrite and exports without claim secrets", async () => {
    const env=await setupFlow(),dir=tempDir("loreforge-backup-test-");
    try {
      const task=await flowCreate(env,"muse","backup-task"),claim=await flowClaim(env,"muse","backup-claim",task.id);
      assert.ok(statSync(resolveDbPath(env.held.home)+"-wal").size>0);
      const backup=join(dir,"backup.sqlite3");await backupState(env.held.home,backup);assert.ok(existsSync(backup));
      await assert.rejects(backupState(env.held.home,backup),/already exists/);
      const exported=JSON.stringify(exportState(env.held.home,env.projectId));assert.ok(exported.includes(task.id));assert.ok(!exported.includes(claim.claimToken));assert.ok(!exported.includes("mutation_receipts"));
      const restoredHome=join(dir,"restored");await restoreState(backup,restoredHome);
      const core=openCore({home:restoredHome});try {const got=await execOk<{task:{id:string}}>(core,readRequest("task.get",env.projectId,{taskId:task.id}));assert.equal(got.task.id,task.id);}finally {core.close();}
      await assert.rejects(restoreState(backup,restoredHome),/nonexistent/);
      const future=join(dir,"future.sqlite3");copyFileSync(backup,future);const futureDb=new DatabaseSync(future);futureDb.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(999,Date.now());futureDb.close();
      await assert.rejects(restoreState(future,join(dir,"future-home")),/unsupported/);assert.equal(existsSync(join(dir,"future-home")),false);
      const incomplete=join(dir,"incomplete.sqlite3");copyFileSync(backup,incomplete);const broken=new DatabaseSync(incomplete);broken.exec("DROP TABLE reviews");broken.close();
      await assert.rejects(restoreState(incomplete,join(dir,"incomplete-home")),/incomplete/);
      const corrupt=join(dir,"corrupt");writeFileSync(corrupt,"not a database");await assert.rejects(restoreState(corrupt,join(dir,"bad-restore")));assert.equal(existsSync(join(dir,"bad-restore")),false);
    } finally {env.cleanup();removeDir(dir);}
  });

  it("observes large Git status without buffering the listing", async () => {
    const env=await setupFlow();try {for(let i=0;i<800;i++)writeFileSync(join(env.repo,`${i}-${"x".repeat(90)}`),"test");const observed=await observeCheckout(env.repo,Date.now());assert.equal(observed.dirty,true);}finally {env.cleanup();}
  });
});
