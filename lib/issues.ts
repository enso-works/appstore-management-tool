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
