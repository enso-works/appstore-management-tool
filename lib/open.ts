import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONFIG_FILENAME } from "./config";
import { listRegistered } from "./registered";

/** The installed package root, which is where next has to run from. */
function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    // Bound on the wildcard, not 127.0.0.1: next listens on ::, and on macOS a
    // specific IPv4 bind succeeds alongside an IPv6 wildcard, so checking
    // loopback reports a busy port as free.
    server.listen(port);
  });
}

async function pickPort(preferred?: number): Promise<number> {
  const start = preferred ?? 3000;
  for (let port = start; port < start + 50; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port between ${start} and ${start + 49}.`);
}

/** Already-running instance of this tool, so `open` twice reuses the first. */
async function findRunning(): Promise<number | undefined> {
  // Asking over HTTP is the only reliable signal: a port can be bound in ways a
  // bind test does not see, and only this endpoint proves it is *us* answering.
  for (let port = 3000; port < 3010; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return port;
    } catch {
      // Nothing there, or something else that is not this tool.
    }
  }
  return undefined;
}

function browserCommand(url: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

/**
 * Resolve what to open: an explicit name or directory, otherwise the app you
 * are standing in. Falling back to the project list means `open` from anywhere
 * still lands somewhere useful rather than erroring.
 */
function resolveTarget(target?: string): string | undefined {
  const registered = listRegistered();

  if (target) {
    const byName = registered.find((p) => p.name === target);
    if (byName) return byName.name;
    const resolved = path.resolve(target);
    const byRoot = registered.find((p) => path.resolve(p.root) === resolved);
    if (byRoot) return byRoot.name;
    return undefined;
  }

  const cwd = process.cwd();
  const here = registered.find((p) => {
    const root = path.resolve(p.root);
    return cwd === root || cwd.startsWith(`${root}${path.sep}`);
  });
  if (here) return here.name;

  return fs.existsSync(path.join(cwd, CONFIG_FILENAME)) ? path.basename(cwd) : undefined;
}

async function waitForServer(port: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export interface OpenOptions {
  target?: string;
  port?: number;
  openBrowser?: boolean;
}

export async function openEditor(opts: OpenOptions = {}): Promise<void> {
  const root = packageRoot();
  const targetName = resolveTarget(opts.target);
  const suffix = targetName ? `/projects/${encodeURIComponent(targetName)}` : "";

  if (opts.target && !targetName) {
    console.error(`Not in your list: ${opts.target}`);
    console.error("Run `store-shots projects` to see what is there, or `store-shots add <dir>`.");
    process.exitCode = 2;
    return;
  }

  const running = opts.port ? undefined : await findRunning();
  if (running) {
    const url = `http://localhost:${running}${suffix}`;
    console.log(`Already running on port ${running}.`);
    await launchBrowser(url, opts.openBrowser !== false);
    return;
  }

  const port = await pickPort(opts.port);
  // An installed copy ships a build and should serve it. A git checkout is
  // being worked on, so dev is right there even if a stale .next lingers -
  // otherwise `open` would quietly serve the last build instead of the code.
  const isCheckout = fs.existsSync(path.join(root, ".git"));
  const built = !isCheckout && fs.existsSync(path.join(root, ".next", "BUILD_ID"));
  const nextBin = path.join(root, "node_modules", ".bin", "next");

  if (!fs.existsSync(nextBin)) {
    console.error(`Cannot find next in ${root}. Run \`npm ci\` there first.`);
    process.exitCode = 2;
    return;
  }

  console.log(`Starting the editor on port ${port} (${built ? "production" : "dev"})...`);
  const child = spawn(nextBin, [built ? "start" : "dev", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT: String(port) },
  });

  const stop = () => {
    child.kill("SIGINT");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (!(await waitForServer(port))) {
    console.error("The editor did not come up in time.");
    child.kill("SIGINT");
    process.exitCode = 1;
    return;
  }

  const url = `http://localhost:${port}${suffix}`;
  await launchBrowser(url, opts.openBrowser !== false);
  console.log(`\n${url}`);
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
}

async function launchBrowser(url: string, shouldOpen: boolean) {
  if (!shouldOpen) {
    console.log(url);
    return;
  }
  const [cmd, args] = browserCommand(url);
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    console.log(`Opened ${url}`);
  } catch {
    console.log(`Open ${url}`);
  }
}
