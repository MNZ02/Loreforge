import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { discoverProject } from "../evidence/git.js";
import { resolveHomeDir } from "./home.js";
import { readProjectBinding } from "./project-config.js";
import { databaseExists, resolveDbPath } from "../storage/db.js";
import { MIGRATIONS } from "../storage/schema.js";
import { backupState, restoreState, exportState, renderExport, writeExport } from "../storage/maintenance.js";
import { CliValidationError, type ManagementArgs } from "./args.js";
import { sanitizePeerText } from "../context/render.js";

export function currentProject(home: string): {projectId: string; home: string; root: string} {
  const identity = discoverProject(process.cwd());
  if (!databaseExists(home)) throw new CliValidationError("Repository is not configured; run lore init");
  const db = new DatabaseSync(resolveDbPath(home), {readOnly:true});
  try {
    const row = db.prepare("SELECT id FROM projects WHERE git_common_dir = ?").get(identity.gitCommonDir);
    if (!row) throw new CliValidationError("This repository is not registered in the selected home; run lore init --home <dir>");
    return {projectId: String(row.id), home, root: identity.root};
  } finally {db.close();}
}

export function diagnose(home: string): {healthy: boolean; home: string; checks: Array<{name:string; ok:boolean; message:string}>} {
  const checks: Array<{name:string; ok:boolean; message:string}> = [];
  try { const project = currentProject(home); checks.push({name:"project",ok:true,message:`Project ${project.projectId}`}); }
  catch (error) { checks.push({name:"project",ok:false,message: error instanceof Error ? error.message : "Run lore init"}); }
  try {
    const binding = readProjectBinding();
    checks.push({name:"configuration",ok:!!binding && binding.home === home,message: binding ? binding.home === home ? "Repository binding matches selected home" : "Selected home overrides repository binding; verify this is intentional" : "No repository binding; run lore init to enable automatic resolution"});
  } catch (error) { checks.push({name:"configuration",ok:false,message:String(error)}); }
  if (databaseExists(home)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(resolveDbPath(home), {readOnly:true});
      const version = (db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number}).version;
      checks.push({name:"schema",ok:version === MIGRATIONS.at(-1)!.version,message:version > MIGRATIONS.at(-1)!.version ? "Upgrade Loreforge: state schema is newer" : version < MIGRATIONS.at(-1)!.version ? "Run a Loreforge operation to apply pending migrations; back up first" : `Schema ${version} is current`});
      const rows = db.prepare("PRAGMA integrity_check").all();
      const healthy = rows.length === 1 && Object.values(rows[0])[0] === "ok" && db.prepare("PRAGMA foreign_key_check").all().length === 0;
      checks.push({name:"integrity",ok:healthy,message:healthy ? "SQLite integrity and references pass" : "Restore a verified backup; database integrity check failed"});
      const roots = db.prepare("SELECT root FROM projects").all();
      const missing = roots.filter(row=>!existsSync(String(row.root))).length;
      checks.push({name:"roots",ok:missing===0,message:missing ? `${missing} registered checkout(s) are missing; verify repository locations` : "Registered checkout paths exist"});
    } catch { checks.push({name:"database",ok:false,message:"Cannot read state; check permissions and use a compatible Loreforge version"}); }
    finally {db?.close();}
  } else checks.push({name:"database",ok:false,message:"No state database; run lore init"});
  try {
    const root = discoverProject(process.cwd()).root;
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const path = join(root,file);
      if (!existsSync(path)) continue;
      const text = readFileSync(path,"utf8");
      const binding = readProjectBinding();
      const mentioned = [...text.matchAll(/Project(?: ID)?:\s*`?([0-9a-f-]{36})/gi)].map(match=>match[1]);
      if (binding && mentioned.some(id=>id!==binding.projectId)) checks.push({name:"rules",ok:false,message:`${file} contains another project binding; rerun init --write-rules`});
    }
  } catch { /* Project check reports the failure. */ }
  return {healthy:checks.every(check=>check.ok),home,checks};
}

export async function runManagement(args: ManagementArgs, env: Record<string,string|undefined>, stdout: NodeJS.WritableStream): Promise<number> {
  const home = resolveHomeDir(args.home, env);
  if (args.command === "mcp") { const {serveMcp} = await import("../mcp/server.js"); await serveMcp(home); return 0; }
  let data: unknown;
  if (args.command === "doctor") data = diagnose(home);
  else if (args.command === "current") data = currentProject(home);
  else if (args.command === "backup") data = await backupState(home,args.output!);
  else if (args.command === "restore") data = await restoreState(args.input!,home);
  else {
    const records = exportState(home,args.projectId);
    const text = args.format === "markdown" ? renderExport(records) : JSON.stringify(records,null,2)+"\n";
    if (args.output) {writeExport(args.output,text); data = {path:args.output};}
    else {stdout.write(text);return 0;}
  }
  stdout.write(args.json ? JSON.stringify({schemaVersion:1,ok:true,data})+"\n" : sanitizePeerText(JSON.stringify(data,null,2))+"\n");
  return args.command === "doctor" && !(data as {healthy:boolean}).healthy ? 1 : 0;
}
