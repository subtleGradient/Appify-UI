import { describe, expect, test } from "bun:test";
import { parseArgsText } from "../src/args";

describe("argument parser", () => {
  test("splits whitespace and preserves quoted groups", () => {
    expect(parseArgsText("--name 'two words' \"three words\" a\\ b \"\"")).toEqual([
      "--name",
      "two words",
      "three words",
      "a b",
      "",
    ]);
  });

  test("does not evaluate shell syntax", () => {
    expect(parseArgsText("$(whoami) '$HOME' \"*.ts\"")).toEqual([
      "$(whoami)",
      "$HOME",
      "*.ts",
    ]);
  });

  test("rejects unfinished quotes and escapes", () => {
    expect(() => parseArgsText("'unterminated")).toThrow("unclosed single quote");
    expect(() => parseArgsText("abc\\")).toThrow("unfinished escape");
  });
});
