import { describe, expect, test } from "bun:test";
import { mergeToml, parseToml } from "../src/util/toml.ts";
import { zodToJsonSchema } from "../src/util/jsonschema.ts";
import { globToRegExp } from "../src/tools/search.ts";
import { z } from "zod";

describe("parseToml", () => {
  test("parses sections and scalar values", () => {
    const cfg = parseToml(`
model = "anthropic:claude-sonnet-4-5"
max_tokens = 4096
temperature = 0.5

[providers.openai]
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"

[tools]
always_ask = ["write", "edit"] # keep asking
`);
    expect(cfg.model).toBe("anthropic:claude-sonnet-4-5");
    expect(cfg.max_tokens).toBe(4096);
    expect(cfg.temperature).toBe(0.5);
    const providers = cfg.providers as Record<string, Record<string, unknown>>;
    expect(providers.openai!.base_url).toBe("https://api.openai.com/v1");
    const tools = cfg.tools as Record<string, unknown>;
    expect(tools.always_ask).toEqual(["write", "edit"]);
  });

  test("ignores comments inside quotes", () => {
    const cfg = parseToml(`model = "a#b" # comment`);
    expect(cfg.model).toBe("a#b");
  });
});

describe("mergeToml", () => {
  test("deep-merges nested tables", () => {
    const merged = mergeToml(
      { a: { x: 1, y: 2 }, b: 3 },
      { a: { y: 20 }, c: 4 },
    );
    expect(merged).toEqual({ a: { x: 1, y: 20 }, b: 3, c: 4 });
  });
});

describe("zodToJsonSchema", () => {
  test("converts an object schema with optionals and defaults", () => {
    const schema = z.object({
      path: z.string().describe("file path"),
      count: z.number().int().min(1).default(5),
      flag: z.boolean().optional(),
      mode: z.enum(["a", "b"]),
      tags: z.array(z.string()),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["path", "mode", "tags"]);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.path).toMatchObject({ type: "string", description: "file path" });
    expect(props.count).toMatchObject({ type: "integer", minimum: 1, default: 5 });
    expect(props.flag).toEqual({ type: "boolean" });
    expect(props.mode).toEqual({ type: "string", enum: ["a", "b"] });
    expect(props.tags).toEqual({ type: "array", items: { type: "string" } });
  });
});

describe("globToRegExp", () => {
  test.each([
    ["*.ts", "foo.ts", true],
    ["*.ts", "src/foo.ts", false],
    ["src/**/*.ts", "src/a/b/c.ts", true],
    ["src/**/*.ts", "src/c.ts", true],
    ["**/*.md", "docs/readme.md", true],
    ["exact.txt", "exact.txt", true],
    ["exact.txt", "exact2.txt", false],
    ["src/?.ts", "src/a.ts", true],
  ])("glob %s vs %s → %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});
