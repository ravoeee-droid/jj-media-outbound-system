import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
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
  ".transfer/current/part08",
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
if (!existsSync(join(source, "app/dashboard/page.tsx"))) {
  throw new Error("Entpackter Projektcode ist unvollständig.");
}
cpSync(source, root, { recursive: true, force: true });

// The public JJ-Media website is served by the jj-clone project. This app lives
// behind the same hostname at /admin, so Next.js needs a native basePath. A
// wrapper keeps every existing Next.js option intact while adding the basePath.
const configCandidates = [
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
  "next.config.cjs",
];
const existingConfig = configCandidates.find((name) => existsSync(join(root, name)));
const packagePath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));

if (existingConfig) {
  const extension = extname(existingConfig);
  const stem = existingConfig.slice(0, -extension.length);
  const baseName = `${stem}.jj-base${extension}`;
  renameSync(join(root, existingConfig), join(root, baseName));

  const packageIsEsm = pkg.type === "module";
  const isEsm = extension === ".mjs" || extension === ".ts" || (extension === ".js" && packageIsEsm);

  if (extension === ".ts") {
    writeFileSync(
      join(root, existingConfig),
      `import baseConfig from "./${baseName.replace(/\.ts$/, "")}";\n\n` +
        `const withAdminBasePath = typeof baseConfig === "function"\n` +
        `  ? (...args: any[]) => ({ ...baseConfig(...args), basePath: "/admin" })\n` +
        `  : { ...baseConfig, basePath: "/admin" };\n\n` +
        `export default withAdminBasePath;\n`,
    );
  } else if (isEsm) {
    writeFileSync(
      join(root, existingConfig),
      `import baseConfig from "./${baseName}";\n\n` +
        `const withAdminBasePath = typeof baseConfig === "function"\n` +
        `  ? (...args) => ({ ...baseConfig(...args), basePath: "/admin" })\n` +
        `  : { ...baseConfig, basePath: "/admin" };\n\n` +
        `export default withAdminBasePath;\n`,
    );
  } else {
    writeFileSync(
      join(root, existingConfig),
      `const imported = require("./${baseName}");\n` +
        `const baseConfig = imported.default ?? imported;\n\n` +
        `module.exports = typeof baseConfig === "function"\n` +
        `  ? (...args) => ({ ...baseConfig(...args), basePath: "/admin" })\n` +
        `  : { ...baseConfig, basePath: "/admin" };\n`,
    );
  }
} else {
  writeFileSync(join(root, "next.config.mjs"), `export default { basePath: "/admin" };\n`);
}

pkg.engines = { ...(pkg.engines || {}), node: ">=22.17.0" };
pkg.scripts = { ...(pkg.scripts || {}), "vercel-build": "next build" };
delete pkg.scripts.postinstall;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
rmSync(join(root, ".transfer"), { recursive: true, force: true });
rmSync(join(root, "scripts/bootstrap-source.mjs"), { force: true });
rmSync(work, { recursive: true, force: true });
console.log("JJ-Media source restored, verified and mounted at /admin.");
