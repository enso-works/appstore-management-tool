export type IssueLevel = "error" | "warn" | "info";

export interface Issue {
  level: IssueLevel;
  /** Stable machine-readable code, e.g. "content.missing-field". */
  code: string;
  message: string;
  /** Render-job key or other locator: <target>/<locale>/<screen>, <locale>/<field>, ... */
  key?: string;
  /** App-root-relative file the user should edit. */
  file?: string;
  hint?: string;
}

export class IssueList {
  readonly items: Issue[] = [];

  add(issue: Issue): this {
    this.items.push(issue);
    return this;
  }

  error(code: string, message: string, extra: Omit<Issue, "level" | "code" | "message"> = {}): this {
    return this.add({ level: "error", code, message, ...extra });
  }

  warn(code: string, message: string, extra: Omit<Issue, "level" | "code" | "message"> = {}): this {
    return this.add({ level: "warn", code, message, ...extra });
  }

  info(code: string, message: string, extra: Omit<Issue, "level" | "code" | "message"> = {}): this {
    return this.add({ level: "info", code, message, ...extra });
  }

  get errors(): Issue[] {
    return this.items.filter((i) => i.level === "error");
  }

  get warnings(): Issue[] {
    return this.items.filter((i) => i.level === "warn");
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  merge(other: IssueList): this {
    this.items.push(...other.items);
    return this;
  }
}

export function formatIssue(issue: Issue): string {
  const tag = issue.level === "error" ? "ERROR" : issue.level === "warn" ? "WARN " : "INFO ";
  const where = issue.key ? `[${issue.key}] ` : "";
  const lines = [`${tag} ${where}${issue.message}`];
  if (issue.file) lines.push(`      file: ${issue.file}`);
  if (issue.hint) lines.push(`      hint: ${issue.hint}`);
  return lines.join("\n");
}

/**
 * Issues for a terminal: three or more of the same problem in one place fold
 * into one line, so a new app's missing captures and theme prompts read as one
 * thing to do each, not twenty. Folded: missing captures in one folder, theme
 * prompts in one copy file. JSON output and the editors keep every issue.
 */
export function foldIssues(issues: Issue[], min = 3): Issue[] {
  const groupOf = (i: Issue): string | undefined => {
    if (!i.file || !i.key) return undefined;
    if (i.code === "source.missing") return `${i.level}|${i.code}|${i.file.slice(0, i.file.lastIndexOf("/") + 1)}`;
    if (i.code === "content.starter-copy") return `${i.level}|${i.code}|${i.file}`;
    return undefined;
  };
  const groups = new Map<string, Issue[]>();
  for (const i of issues) {
    const g = groupOf(i);
    if (g) groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  const out: Issue[] = [];
  const done = new Set<string>();
  for (const i of issues) {
    const g = groupOf(i);
    const members = g ? groups.get(g)! : [];
    if (!g || members.length < min) {
      out.push(i);
      continue;
    }
    if (done.has(g)) continue;
    done.add(g);
    out.push(i.code === "source.missing" ? foldMissing(members) : foldPrompts(members));
  }
  return out;
}

const lastSegment = (key: string) => key.slice(key.lastIndexOf("/") + 1);
const withoutLastSegment = (key: string) => key.slice(0, key.lastIndexOf("/"));

function foldMissing(members: Issue[]): Issue {
  const first = members[0];
  const screens = members.map((m) => lastSegment(m.key!));
  return {
    ...first,
    key: withoutLastSegment(first.key!),
    message: `Raw captures not found for ${screens.length} screens: ${screens.join(", ")}`,
    file: first.file!.slice(0, first.file!.lastIndexOf("/") + 1),
    hint: first.hint
      ?.replace("capture it with:", "capture each with:")
      .replace(`--screen ${screens[0]}`, "--screen <id>"),
  };
}

function foldPrompts(members: Issue[]): Issue {
  const first = members[0];
  const fields = members.map((m) => m.message.slice(0, m.message.indexOf(" ")));
  return {
    ...first,
    key: first.key!.slice(0, first.key!.indexOf("/")),
    message: `${fields.length} fields still hold the theme's prompts: ${fields.join(", ")}`,
  };
}
