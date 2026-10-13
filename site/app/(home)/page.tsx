import Link from "next/link";
import { repoUrl } from "@/lib/shared";

const sections = [
  { title: "Design", text: "Every screen on a canvas that is the exact render the store gets.", href: "/docs/design" },
  {
    title: "Themes",
    text: "Nine finished looks drawn in your app's own colour, picked when you import or any time after.",
    href: "/docs/design/themes",
  },
  {
    title: "Pages",
    text: "The default page, custom product pages, optimization tests, header and search images, iPhone Duo.",
    href: "/docs/pages",
  },
  {
    title: "Listing",
    text: "Name, subtitle, keywords and the rest of the store text, with the store's limits.",
    href: "/docs/listing",
  },
  {
    title: "Ship",
    text: "Readiness checks with the fix for each, fastlane uploads, drafts in App Store Connect.",
    href: "/docs/ship",
  },
  {
    title: "Agents",
    text: "Everything runs headless for Claude Code or Codex: previews to look at, JSON answers, exit codes.",
    href: "/docs/agents",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-16">
      <div className="flex max-w-3xl flex-col gap-5">
        <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
          App Store and Google Play screenshots, built from your app&apos;s real captures.
        </h1>
        <p className="text-lg text-pretty text-fd-muted-foreground">
          A native Mac app, and a command line a coding agent can drive, over an open-source engine that runs on your
          machine. It checks your screenshots and store text against the rules that get listings rejected, while you
          edit and again before anything ships.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <a
            href={repoUrl}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            Source on GitHub
          </a>
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element -- a static export serves images as they are */}
      <img
        src="/images/hero.png"
        width={4042}
        height={934}
        alt="Rallo's App Store listing: eight landscape screenshots in one stadium, a 3D player in front of each phone"
        className="w-full rounded-xl border"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.title} href={s.href} className="rounded-xl border p-4 transition-colors hover:bg-fd-accent">
            <h2 className="font-medium">{s.title}</h2>
            <p className="mt-1 text-sm text-fd-muted-foreground">{s.text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
