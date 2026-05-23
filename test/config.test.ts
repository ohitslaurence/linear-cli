import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "../src/config";

describe("parseEnvFile", () => {
  test("parses plain KEY=value pairs", () => {
    const map = parseEnvFile("LINEAR_API_KEY=lin_abc123");
    expect(map.get("LINEAR_API_KEY")).toBe("lin_abc123");
  });

  test("supports `export` and quoted values", () => {
    const map = parseEnvFile('export LINEAR_API_KEY="lin_xyz"\nOTHER=\'plain\'');
    expect(map.get("LINEAR_API_KEY")).toBe("lin_xyz");
    expect(map.get("OTHER")).toBe("plain");
  });

  test("ignores comments and blank lines", () => {
    const map = parseEnvFile("# a comment\n\n  \nA=1\n");
    expect(map.get("A")).toBe("1");
    expect(map.size).toBe(1);
  });

  test("keeps '=' characters inside the value", () => {
    const map = parseEnvFile("TOKEN=a=b=c");
    expect(map.get("TOKEN")).toBe("a=b=c");
  });
});
