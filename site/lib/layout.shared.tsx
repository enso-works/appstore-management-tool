import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, repoUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-semibold tracking-tight">{appName}</span>,
    },
    githubUrl: repoUrl,
  };
}
