import path from "node:path";
import { Command } from "commander";
import { ConfigError, loadProject, resolveProjectArg, type Project } from "../lib/config";
import { formatIssue, type Issue } from "../lib/issues";
import { initProject } from "../lib/init";
import { readinessReport, type ReadinessReport } from "../lib/readiness";
import { defaultWorkspaceRoot, discoverProjects } from "../lib/registry";
import { describeJob } from "../lib/render-plan";
import { validateProject } from "../lib/validate";
import { displayRelative } from "../lib/paths";

const program = new Command();

program
  .name("store-shots")
  .description("App Store screenshot generation and store management for the apps in this workspace")
  .option("--workspace <dir>", "workspace root (default: the directory containing tools/store-shots)")
  .showHelpAfterError()
  // Usage errors exit 2 (README: 0 ok, 1 validation/readiness failed, 2 usage or config error).
  .exitOverride((err) => {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version" || err.code === "commander.help") {
      process.exit(0);
    }
    process.exit(2);
  });

function workspaceRoot(): string {
  const opt = program.opts<{ workspace?: string }>().workspace;
  return opt ? path.resolve(opt) : defaultWorkspaceRoot();
}

function openProject(projectArg: string | undefined): Project {
  try {
    return loadProject(resolveProjectArg(projectArg));
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}

function printIssues(issues: Issue[]) {
  for (const i of issues) console.log(formatIssue(i));
}

program
  .command("projects")
  .description("List every app in the workspace that has a store-shots.config.json")
  .option("--json", "machine-readable output")
  .action((opts: { json?: boolean }) => {
    const found = discoverProjects(workspaceRoot());
    if (opts.json) {
      console.log(
        JSON.stringify(
          found.map((f) => ({
            name: f.name,
            root: f.root,
            projectName: f.project?.config.projectName,
            error: f.error,
          })),
          null,
          2,
        ),
      );
      return;
    }
    if (found.length === 0) {
      console.log(`No projects found under ${workspaceRoot()}. Run \`store-shots init --project <app-dir>\`.`);
      return;
    }
    for (const f of found) {
      const label = f.project
        ? `${f.project.config.projectName} (${f.project.config.locales.length} locales, ${f.project.config.targets.length} targets)`
        : `INVALID: ${f.error}`;
      console.log(`${f.name.padEnd(20)} ${label}`);
    }
  });

program
  .command("init")
  .description("Scaffold store/ and store-shots.config.json into an app directory")
  .requiredOption("--project <dir>", "app directory")
  .option("--name <name>", "project name (default: app.json name)")
  .option(
    "--locales <list>",
    "comma-separated store locales (default: fastlane/metadata dirs or CFBundleLocalizations)",
  )
  .option("--default-locale <locale>", "default locale (default: en-US if present)")
  .option("--force", "overwrite existing files")
  .action((opts: { project: string; name?: string; locales?: string; defaultLocale?: string; force?: boolean }) => {
    const result = initProject({
      appRoot: path.resolve(opts.project),
      projectName: opts.name,
      locales: opts.locales
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      defaultLocale: opts.defaultLocale,
      force: opts.force,
    });
    for (const f of result.created) console.log(`created  ${f}`);
    for (const f of result.skipped) console.log(`skipped  ${f} (exists)`);
    console.log(`\nProject "${result.config.projectName}" with locales ${result.config.locales.join(", ")}.`);
    console.log("Next: add raw captures under store/raw/<device>/<locale>/, then `store-shots validate`.");
  });

program
  .command("validate")
  .description("Validate config, manifest, copy, raw captures and per-set counts (no rendering)")
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .option("--json", "machine-readable output")
  .option("--dry-run", "also print the render plan")
  .action((opts: { project?: string; json?: boolean; dryRun?: boolean }) => {
    const project = openProject(opts.project);
    const result = validateProject(project);
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            project: project.config.projectName,
            ok: !result.issues.hasErrors,
            issues: result.issues.items,
            plan: result.plan.map((j) => ({
              key: j.key,
              source: displayRelative(project.root, j.sourcePath),
              output: displayRelative(project.root, j.outputPath),
            })),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`Validating ${project.config.projectName} (${displayRelative(process.cwd(), project.root) || "."})`);
      printIssues(result.issues.items);
      if (opts.dryRun) {
        console.log(`\nRender plan (${result.plan.length} jobs):`);
        for (const job of result.plan) console.log("  " + describeJob(project, job));
      }
      const e = result.issues.errors.length;
      const w = result.issues.warnings.length;
      console.log(`\n${e} error(s), ${w} warning(s), ${result.plan.length} render job(s)`);
    }
    process.exit(result.issues.hasErrors ? 1 : 0);
  });

program
  .command("readiness")
  .description("Store readiness checks: metadata, limits, screenshots, icon, credentials, placeholders")
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .option("--json", "machine-readable output")
  .action((opts: { project?: string; json?: boolean }) => {
    const project = openProject(opts.project);
    const report = readinessReport(project);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReadiness(report);
    }
    process.exit(report.status === "fail" ? 1 : 0);
  });

function printReadiness(report: ReadinessReport) {
  console.log(`Store readiness: ${report.project}`);
  const mark: Record<string, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };
  for (const c of report.checks) {
    console.log(`${mark[c.status]}  ${c.title}`);
    for (const d of c.details) console.log(`        - ${d}`);
    if (c.status !== "pass" && c.status !== "skip" && c.hint) console.log(`        hint: ${c.hint}`);
  }
  console.log(`\nOverall: ${mark[report.status]}`);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
