import { describe, expect, it } from "vitest";
import { foldIssues, type Issue } from "../lib/issues";

const missing = (device: string, screen: string, order: number): Issue => ({
  level: "error",
  code: "source.missing",
  message: "Raw capture not found",
  key: `${device}-target/en-US/${screen}`,
  file: `store/raw/${device}/en-US/0${order}-${screen}.png`,
  hint: `capture it with: store-shots capture --device ${device} --locale en-US --screen ${screen}`,
});

const prompt = (field: string): Issue => ({
  level: "warn",
  code: "content.starter-copy",
  message: `${field} in en-US is still the theme's prompt: "x"`,
  key: `en-US/${field.split(".")[0]}`,
  file: "store/content/en-US.json",
  hint: "write the screen's own copy",
});

describe("folding issues for the terminal", () => {
  it("folds missing captures per folder and theme prompts per file, where the first one was", () => {
    const other: Issue = { level: "error", code: "x.other", message: "something else" };
    const issues = [
      prompt("hero.headline"),
      prompt("hero.caption"),
      prompt("feature-1.headline"),
      other,
      missing("iphone", "hero", 1),
      missing("iphone", "feature-1", 2),
      missing("iphone", "feature-2", 3),
      missing("ipad", "hero", 1),
    ];
    const folded = foldIssues(issues);
    expect(folded.map((i) => i.message)).toEqual([
      "3 fields still hold the theme's prompts: hero.headline, hero.caption, feature-1.headline",
      "something else",
      "Raw captures not found for 3 screens: hero, feature-1, feature-2",
      "Raw capture not found",
    ]);
    expect(folded[0].key).toBe("en-US");
    expect(folded[2]).toMatchObject({
      key: "iphone-target/en-US",
      file: "store/raw/iphone/en-US/",
      hint: "capture each with: store-shots capture --device iphone --locale en-US --screen <id>",
    });
  });

  it("leaves two of a kind as they are", () => {
    const issues = [missing("iphone", "hero", 1), missing("iphone", "feature-1", 2)];
    expect(foldIssues(issues)).toEqual(issues);
  });
});
