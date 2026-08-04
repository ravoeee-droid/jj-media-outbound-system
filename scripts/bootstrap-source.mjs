import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const files = [
  ".transfer/current/part00",
  ".transfer/current/part01",
  ".transfer/current/part02",
  ".transfer/current/part03",
  ".transfer/fix/part04-0",
  ".transfer/fix/part04-1",
  ".transfer/fix/part04-2",
  ".transfer/fix/part04-3",
  ".transfer/fix/part05-0",
  ".transfer/fix/part05-1",
  ".transfer/fix/part05-2",
  ".transfer/fix/part05-3",
  ".transfer/current/part06",
  ".transfer/fix/part07-0",
  ".transfer/fix/part07-1",
  ".transfer/fix/part07-2",
  ".transfer/fix/part07-3",
  ".transfer/current/part08"
];

for (const file of files) {
  if (!existsSync(join(root, file))) throw new Error(`Archivsegment fehlt: ${file}`);
}

const base64 = files.map((file) => readFileSync(join(root, file), "utf8")).join("");
const archive = Buffer.from(base64, "base64");
const expected = "94752c816ef8ea31560edfdcb8cc1026b840281788a03e1521548e6cd6fb8e94";
const actual = createHash("sha256").update(archive).digest("hex");
if (actual !== expected) throw new Error(`Archivprüfung fehlgeschlagen: ${actual}`);

const work = join(tmpdir(), `jj-media-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const archivePath = join(work, "source.tar.xz");
writeFileSync(archivePath, archive);
execFileSync("tar", ["-xJf", archivePath, "-C", work], { stdio: "inherit" });
const source = join(work, "Website-Master-main");
if (!existsSync(join(source, "app/dashboard/page.tsx"))) throw new Error("Entpackter Projektcode ist unvollständig.");
cpSync(source, root, { recursive: true, force: true });

const packagePath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
pkg.engines = { ...(pkg.engines || {}), node: ">=22.17.0" };
pkg.scripts = { ...(pkg.scripts || {}), "vercel-build": "next build" };
delete pkg.scripts.postinstall;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
rmSync(join(root, ".transfer"), { recursive: true, force: true });
rmSync(join(root, "scripts/bootstrap-source.mjs"), { force: true });
rmSync(work, { recursive: true, force: true });
console.log("JJ-Media source restored and verified.");
