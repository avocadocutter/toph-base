-- Migrate read_file and list_files executor logic from hardcoded core code
-- into execute_script. After this, all tool execution goes through the DB.
-- ctx available in scripts: { agentTypeId, workspaceDir, fs, path }

UPDATE admin_tools SET execute_script = $read_file$
const sep = ctx.path.sep;
const filePath = ctx.path.resolve(ctx.workspaceDir, params.path);
if (!filePath.startsWith(ctx.workspaceDir + sep) && filePath !== ctx.workspaceDir) {
  throw new Error("Access denied: path is outside the agent workspace");
}
if (!ctx.fs.existsSync(filePath)) throw new Error("File not found: " + params.path);
const stat = ctx.fs.statSync(filePath);
if (!stat.isFile()) throw new Error("Not a file: " + params.path);
const raw = ctx.fs.readFileSync(filePath, "utf-8");
const allLines = raw.split("\n");
const offset = params.offset ? Math.max(1, params.offset) : 1;
const startIndex = offset - 1;
const lines = params.limit
  ? allLines.slice(startIndex, startIndex + params.limit)
  : allLines.slice(startIndex);
const numbered = lines.map((line, i) => (offset + i) + "\t" + line).join("\n");
return {
  content: [{ type: "text", text: numbered }],
  details: { path: params.path, totalLines: allLines.length, linesReturned: lines.length, offset },
};
$read_file$ WHERE id = 'tool-read-file';

UPDATE admin_tools SET execute_script = $list_files$
function globToRegex(glob) {
  let regex = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { regex += ".*"; i += 2; if (glob[i] === "/") i++; continue; }
      regex += "[^/]*";
    } else if (c === "?") {
      regex += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      regex += "\\" + c;
    } else {
      regex += c;
    }
    i++;
  }
  return "^" + regex + "$";
}
const sep = ctx.path.sep;
const targetDir = params.path
  ? ctx.path.resolve(ctx.workspaceDir, params.path)
  : ctx.workspaceDir;
if (params.path) {
  if (!targetDir.startsWith(ctx.workspaceDir + sep) && targetDir !== ctx.workspaceDir) {
    throw new Error("Access denied: path is outside the agent workspace");
  }
}
ctx.fs.mkdirSync(ctx.workspaceDir, { recursive: true });
if (!ctx.fs.existsSync(targetDir)) throw new Error("Directory not found: " + (params.path || "/"));
const stat = ctx.fs.statSync(targetDir);
if (!stat.isDirectory()) throw new Error("Not a directory: " + (params.path || "/"));
const entries = ctx.fs.readdirSync(targetDir, { withFileTypes: true, recursive: params.recursive ?? false });
const pattern = params.pattern ? new RegExp(globToRegex(params.pattern)) : null;
const results = [];
for (const entry of entries) {
  const relativePath = entry.parentPath
    ? ctx.path.relative(targetDir, ctx.path.join(entry.parentPath, entry.name))
    : entry.name;
  if (pattern && !pattern.test(relativePath)) continue;
  results.push(relativePath + (entry.isDirectory() ? "/" : ""));
}
results.sort();
return {
  content: [{ type: "text", text: results.join("\n") || "(empty directory)" }],
  details: { directory: params.path || "/", count: results.length, recursive: params.recursive ?? false },
};
$list_files$ WHERE id = 'tool-list-files';
