import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initGitRepo, tempDir, removeDir } from "../support/harness.js";
import { runInit, renderInitRule } from "../../src/cli/init.js";
import { parseCliArgs } from "../../src/cli/args.js";
import { handleSuccessOutput } from "../../src/cli/output.js";

const cli=resolve("dist/cli/main.js");
const envFor=(home:string)=>({...process.env,LOREFORGE_HOME:home});
function command(root:string,home:string,args:string[],input?:unknown):any {
  return JSON.parse(execFileSync(process.execPath,[cli,...args,"--json"],{cwd:root,env:envFor(home),encoding:"utf8",input:input===undefined?undefined:JSON.stringify(input)}));
}

describe("package CLI workflows",()=>{
  it("initializes multiple projects, updates/retries the roster and writes generic global rules",async()=>{
    const root=initGitRepo(),other=initGitRepo(),home=tempDir("lore-init-home-"),userHome=tempDir("lore-user-home-");
    try {
      const options={root,home,agents:[{id:"claude",role:"both" as const}],writeRules:true,writeUserRules:true,demo:false,json:true,detect:false};
      const first=await runInit(options,{}, {execPath:"lore",userHome});
      const second=await runInit({...options,root:other},{},{execPath:"lore",userHome});assert.notEqual(first.projectId,second.projectId);
      const changed={...options,agents:[{id:"claude",role:"review" as const}]};await runInit(changed,{}, {execPath:"lore",userHome});await runInit(changed,{}, {execPath:"lore",userHome});
      const decisions=command(root,home,["decision","list","--input","-"],{schemaVersion:1,payload:{}});assert.equal(decisions.data.decisions.length,1);assert.match(decisions.data.decisions[0].body,/claude=review/);
      const global=readFileSync(join(userHome,".claude","rules","loreforge.md"),"utf8");assert.ok(!global.includes(first.projectId));assert.ok(!global.includes(second.projectId));assert.ok(!global.includes(home));
      const current=command(root,home,["project","current"]);assert.equal(current.data.projectId,first.projectId);
      const doctor=command(root,home,["doctor"]);assert.equal(doctor.data.healthy,true);
      // No environment home: the repository binding resolves the right home.
      const cleanEnv={...process.env};for(const key of ["LOREFORGE_HOME","LORE_HOME","AGENT_COMPANY_HOME"])delete cleanEnv[key];
      const automatic=JSON.parse(execFileSync(process.execPath,[cli,"task","list","--claimable","--json"],{cwd:root,env:cleanEnv,encoding:"utf8"}));assert.equal(automatic.ok,true);
    } finally {removeDir(root);removeDir(other);removeDir(home);removeDir(userHome);}
  });

  it("prints inbox bodies safely and emits consistent review instructions",()=>{
    let text="";const stdout=new Writable({write(chunk,_encoding,done){text+=chunk.toString();done();}});
    handleSuccessOutput("inbox.list",{schemaVersion:1,ok:true,data:{events:[{id:1,kind:"question",taskId:"t",questionId:"q",body:"Read this\u001b[2J message"}],nextCursor:1,hasMore:false}},false,stdout);
    assert.match(text,/Read this message/);assert.ok(!text.includes("\u001b"));
    const rule=renderInitRule({execPath:"lore",homeDir:"/tmp/example",projectId:"11111111-1111-4111-8111-111111111111",agentId:"claude",role:"review",roster:[{id:"claude",role:"review"}]});
    assert.ok(rule.includes('"mode":"review"'));assert.ok(!rule.includes('"mode":"work"'));
    assert.throws(()=>parseCliArgs(["search","--input","-","--files","src","--limit","1"]),/do not mix/);
  });

  it("exposes typed operations through a real stdio MCP client without leaking tokens on reads",async()=>{
    const root=initGitRepo(),home=tempDir("lore-mcp-home-");
    const transport=new StdioClientTransport({command:process.execPath,args:[cli,"mcp","--home",home],cwd:root,stderr:"pipe"});
    const client=new Client({name:"lore-test",version:"1.0.0"});
    let stderr="";transport.stderr?.on("data",chunk=>{stderr+=chunk.toString();});
    try {
      await client.connect(transport);
      const list=await client.listTools();assert.equal(list.tools.length,27);
      assert.ok(list.tools.find(t=>t.name==="lore_task_claim")!.inputSchema.properties!.requestId);
      async function call(name:string,args:Record<string,unknown>):Promise<any>{const response=await client.callTool({name,arguments:args});return JSON.parse((response.content as Array<{text:string}>)[0].text);}
      const project=await call("lore_project_register",{schemaVersion:1,requestId:"p",payload:{root,name:"MCP"}});assert.equal(project.ok,true);const projectId=project.data.project.id;
      await call("lore_agent_register",{schemaVersion:1,requestId:"a",payload:{id:"test",displayName:"Test"}});
      const task=await call("lore_task_create",{schemaVersion:1,projectId,actorId:"test",requestId:"t",payload:{title:"MCP task",description:"Test",dependsOn:[]}});assert.equal(task.ok,true);
      const claim=await call("lore_task_claim",{schemaVersion:1,projectId,actorId:"test",requestId:"c",payload:{taskId:task.data.task.id}});assert.equal(claim.ok,true);
      const fetched=await call("lore_task_get",{schemaVersion:1,projectId,payload:{taskId:task.data.task.id}});assert.ok(!JSON.stringify(fetched).includes(claim.data.claimToken));
      const invalid=await call("lore_task_get",{schemaVersion:1,projectId,payload:{taskId:task.data.task.id,extra:"private-marker"}});assert.equal(invalid.error.code,"VALIDATION");assert.ok(!JSON.stringify(invalid).includes("private-marker"));
      assert.ok(!stderr.includes(claim.data.claimToken));
    } finally {await client.close();removeDir(root);removeDir(home);}
  });
});
