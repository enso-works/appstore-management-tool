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
import { generateProject, type GenerationSummary } from "../lib/generate";
import { cleanGenerated } from "../lib/generated-manifest";
import { addGoogleFont, appFontsDir, checkFont, listFonts, resolveFont } from "../lib/fonts";

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

function splitList(v: string | undefined): string[] | undefined {
  const list = v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list && list.length ? list : undefined;
}

program
  .command("generate")
  .description(
    "Render every planned screenshot into fastlane/screenshots/<locale>/ (needs raw captures and a local font)",
  )
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .option("--locale <list>", "only these locales (comma-separated)")
  .option("--screen <list>", "only these screen ids")
  .option("--target <list>", "only these target ids")
  .option("--strict", "any error or warning blocks all output")
  .option("--no-clean", "do not delete previously generated files first")
  .option("--dry-run", "print the render plan and exit")
  .option("--json", "machine-readable summary")
  .action(
    async (opts: {
      project?: string;
      locale?: string;
      screen?: string;
      target?: string;
      strict?: boolean;
      clean: boolean;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const project = openProject(opts.project);
      const filterAll = {
        locales: splitList(opts.locale),
        screens: splitList(opts.screen),
        targets: splitList(opts.target),
      };
      const filter = filterAll.locales || filterAll.screens || filterAll.targets ? filterAll : undefined;
      const summary = await generateProject(project, {
        filter,
        strict: opts.strict,
        noClean: !opts.clean,
        dryRun: opts.dryRun,
        log: opts.json ? undefined : (line) => console.log(line),
      });
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        printSummary(summary, !!opts.dryRun);
      }
      process.exit(summary.aborted || summary.failed > 0 ? 1 : 0);
    },
  );

function printSummary(s: GenerationSummary, dryRun: boolean) {
  if (dryRun) {
    console.log(`Render plan for ${s.project} (${s.planned} job(s)):`);
    for (const j of s.jobs) console.log("  " + j.key);
  }
  const problems = s.issues.filter((i) => i.level !== "info");
  if (problems.length) {
    console.log("");
    printIssues(problems);
  }
  console.log("");
  if (s.aborted)
    console.log(`ABORTED: nothing written (${s.issues.filter((i) => i.level === "error").length} error(s))`);
  console.log(
    `${s.project}: ${s.planned} planned, ${s.rendered} rendered, ${s.failed} failed, ${s.skipped} skipped, ${s.filesWritten.length} file(s) written in ${(s.durationMs / 1000).toFixed(1)} s`,
  );
}

program
  .command("clean")
  .description("Delete only the screenshots recorded in .store-shots-manifest.json")
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .action((opts: { project?: string }) => {
    const project = openProject(opts.project);
    const r = cleanGenerated(project);
    for (const f of r.deleted) console.log(`deleted  ${f}`);
    for (const f of r.missing) console.log(`missing  ${f} (already gone)`);
    console.log(r.manifestRemoved ? "manifest removed" : "nothing to clean");
  });

const fonts = program.command("fonts").description("Manage local font files (downloaded once from Google Fonts)");

fonts
  .command("add <family>")
  .description('Download a Google Fonts family into the app: fonts add "Space Grotesk"')
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .option("--weights <list>", "comma-separated weights (default: from config brand.font.weights)")
  .action(async (family: string, opts: { project?: string; weights?: string }) => {
    const project = openProject(opts.project);
    const weights = splitList(opts.weights)?.map(Number) ?? project.config.brand.font.weights;
    const r = await addGoogleFont({ family, weights, destDir: appFontsDir(project) });
    for (const f of r.files)
      console.log(`added  ${displayRelative(project.root, path.join(r.dir, "..", f.path))}  (${f.weight} ${f.style})`);
    console.log(
      `\n"${r.family}" is now available locally. Set brand.font.family to "${r.family}" in store-shots.config.json if it is not already.`,
    );
  });

fonts
  .command("list")
  .description("List fonts available to this app (app-local and bundled)")
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .action((opts: { project?: string }) => {
    const project = openProject(opts.project);
    const { app, bundled } = listFonts(project);
    console.log("app (store/assets/fonts):");
    for (const f of app) console.log(`  ${f.family}  weights ${f.files.map((x) => x.weight).join(",")}`);
    if (!app.length) console.log("  (none)");
    console.log("bundled with the tool:");
    for (const f of bundled) console.log(`  ${f.family}  weights ${f.files.map((x) => x.weight).join(",")}`);
  });

fonts
  .command("check")
  .description("Verify the configured brand font is available locally and intact")
  .option("--project <dir>", "app directory or config path (default: walk up from cwd)")
  .action((opts: { project?: string }) => {
    const project = openProject(opts.project);
    const family = project.config.brand.font.family;
    const font = resolveFont(project, family);
    if (!font) {
      console.error(`"${family}" is not available. Run: store-shots fonts add "${family}"`);
      process.exit(1);
    }
    const problems = checkFont(font);
    console.log(`"${family}" resolved from ${font.source} (${font.dir}); ${font.files.length} file(s)`);
    for (const p of problems) console.log(`  PROBLEM ${p}`);
    process.exit(problems.length ? 1 : 0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
