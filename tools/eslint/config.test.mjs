import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const eslint = new ESLint({ cwd: root });
// Use existing, tsconfig-included paths with lintText. No fixture writes or
// backend access; projectService receives each sample as an editor buffer.
const tsFile = path.join(root, "src/lib/format.ts");
const tsxFile = path.join(root, "src/components/brand-logo.tsx");

async function lint(code, filePath = tsFile) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages;
}

const invalid = [
  ["legacy static import", 'import { useRouter } from "next/router"; export { useRouter };', "no-restricted-imports"],
  ["legacy re-export", 'export { default as Head } from "next/head";', "no-restricted-imports"],
  ["legacy namespace import", 'import * as router from "next/router.js"; export { router };', "no-restricted-imports"],
  ["legacy request type alias", 'import type { NextApiRequest as Request } from "next"; export type Legacy = Request;', "no-restricted-imports"],
  ["legacy dynamic import", 'export const load = () => import("next/legacy/image");', "komari/app-router-only"],
  ["legacy template import", 'export const load = () => import(`next/router`);', "komari/app-router-only"],
  ["deprecated Image prop inside destructured spread", 'import Image from "next/image"; const { props } = { props: { src: "/x", width: 10, height: 10, priority: true } }; export function Example() { return <Image alt="x" {...props} />; }', "komari/modern-next-components", tsxFile],
  ["explicit any", "export const value: any = 1;", "@typescript-eslint/no-explicit-any"],
  ["ts-ignore", "// @ts-ignore: bypass the type system\nexport const value: number = 'wrong';", "@typescript-eslint/ban-ts-comment"],
  ["ts-nocheck", "// @ts-nocheck\nexport const value = 1;", "@typescript-eslint/ban-ts-comment"],
  ["ts-expect-error", "// @ts-expect-error: bypass the type system\nexport const value: number = 'wrong';", "@typescript-eslint/ban-ts-comment"],
  ["floating promise", "Promise.resolve(1);", "@typescript-eslint/no-floating-promises"],
  ["void is not error handling", "void Promise.reject(new Error('failure'));", "@typescript-eslint/no-floating-promises"],
  ["async IIFE is not exempt", "(async () => { await Promise.resolve(); })();", "@typescript-eslint/no-floating-promises"],
  ["floating thenable", "declare const pending: PromiseLike<number>; pending;", "@typescript-eslint/no-floating-promises"],
  ["async void callback", "[1].forEach(async (value) => { await Promise.resolve(value); });", "komari/no-misused-promises"],
  ["promise used as boolean", "export function check(value: Promise<boolean>) { if (value) return 1; return 0; }", "komari/no-misused-promises"],
  ["awaiting a plain value", "export async function check() { return await 42; }", "@typescript-eslint/await-thenable"],
  ["project deprecated symbol", "/** @deprecated Use replacement. */\nfunction oldApi() {}\nexport function call() { oldApi(); }", "@typescript-eslint/no-deprecated"],
  ["React deprecated type", 'import type { MutableRefObject } from "react"; export type LegacyRef = MutableRefObject<string>;', "@typescript-eslint/no-deprecated"],
  ["Ant Design deprecated property", 'import { Alert } from "antd"; export function Example() { return <Alert message="old" />; }', "@typescript-eslint/no-deprecated", tsxFile],
  ["Next Image deprecated property with lost JSX JSDoc", 'import Image from "next/image"; export function Example() { return <Image src="/x.png" alt="x" width={10} height={10} priority />; }', "komari/modern-next-components", tsxFile],
  ["Next Image deprecated completion callback", 'import Image from "next/image"; export function Example() { return <Image src="/x.png" alt="x" width={10} height={10} onLoadingComplete={() => {}} />; }', "komari/modern-next-components", tsxFile],
  ["Link property without a deprecated tag", 'import Link from "next/link"; export function Example() { return <Link href="/" passHref>首页</Link>; }', "komari/modern-next-components", tsxFile],
  ["async React event handler", 'export function Example() { return <button onClick={async () => { await Promise.resolve(); }}>保存</button>; }', "komari/no-misused-promises", tsxFile],
];

for (const [name, code, rule, file] of invalid) {
  test(`configured lint rejects ${name}`, async () => {
    const messages = await lint(code, file);
    assert.ok(messages.some((message) => message.ruleId === rule && message.severity === 2), JSON.stringify(messages));
  });
}

const asyncCallbacks = [
  ["named antd Popconfirm", 'import { Popconfirm } from "antd";', "Popconfirm", "onConfirm", true],
  ["aliased antd Popconfirm", 'import { Popconfirm as Confirm } from "antd";', "Confirm", "onConfirm", true],
  ["namespace antd Popconfirm", 'import * as Antd from "antd";', "Antd.Popconfirm", "onConfirm", true],
  ["const alias of antd Popconfirm", 'import { Popconfirm } from "antd"; const Confirm = Popconfirm;', "Confirm", "onConfirm", true],
  ["ordinary Antd button", 'import { Button } from "antd";', "Button", "onClick", false],
  ["other Popconfirm callback", 'import { Popconfirm } from "antd";', "Popconfirm", "onCancel", false],
  ["controlled Modal callback", 'import { Modal } from "antd";', "Modal", "onOk", false],
  ["local component named Popconfirm", 'function Popconfirm(props: { title: string; onConfirm: () => void }) { return <button onClick={props.onConfirm}>{props.title}</button>; }', "Popconfirm", "onConfirm", false],
];

for (const [name, declaration, component, attribute, allowed] of asyncCallbacks) {
  test(`async callback exception is precise: ${name}`, async () => {
    const messages = await lint(`${declaration}\nexport function Example() { return <${component} title="确认" ${attribute}={async () => { await Promise.resolve(); }} />; }`, tsxFile);
    if (allowed) {
      assert.deepEqual(messages, []);
    } else {
      assert.ok(messages.some((message) => message.ruleId === "komari/no-misused-promises"), JSON.stringify(messages));
    }
  });
}

test("shadowing an antd import does not inherit its callback exception", async () => {
  const messages = await lint(`
    import { Popconfirm } from "antd";
    export { Popconfirm };
    export function Example({ Popconfirm }: { Popconfirm: (props: { onConfirm: () => void }) => React.ReactNode }) {
      return <Popconfirm onConfirm={async () => { await Promise.resolve(); }} />;
    }
  `, tsxFile);
  assert.ok(messages.some((message) => message.ruleId === "komari/no-misused-promises"), JSON.stringify(messages));
});

test("Popconfirm exception does not hide an unhandled promise inside the callback", async () => {
  const messages = await lint(`
    import { Popconfirm } from "antd";
    export function Example() {
      return <Popconfirm title="确认" onConfirm={async () => { Promise.reject(new Error("failure")); }} />;
    }
  `, tsxFile);
  assert.ok(messages.some((message) => message.ruleId === "@typescript-eslint/no-floating-promises"));
});

const valid = [
  ["await, return and explicit error handling", `
    export async function wait() { await Promise.resolve(); }
    export function forward() { return Promise.resolve(); }
    Promise.reject(new Error('failure')).catch((error: unknown) => { console.error(error); });
  `],
  ["async request APIs can be grouped or forwarded", `
    import { cookies as readCookies, headers, draftMode } from "next/headers";
    export async function request() {
      const [cookieStore, headerStore, draft] = await Promise.all([readCookies(), headers(), draftMode()]);
      return [cookieStore.get("session"), headerStore.get("accept"), draft.isEnabled];
    }
    export function forwardCookies() { return readCookies(); }
  `],
  ["unrelated metadata outside destructured Image props", 'import Image from "next/image"; const { props } = { props: { src: "/x", width: 10, height: 10 }, layout: "grid" }; export function Example() { return <Image alt="x" {...props} />; }', tsxFile],
  ["ordinary params objects", "export function read(params: { id: string }, searchParams: { q: string }) { return params.id + searchParams.q; }"],
  ["uncached route config without Cache Components", 'export const dynamic = "force-dynamic";'],
  ["modern UI properties", `
    import Link from "next/link";
    import Image from "next/image";
    import { Alert } from "antd";
    export function Example() { return <><Link href="/">首页</Link><Image src="/x.png" alt="x" fill style={{ objectFit: "cover" }} /><Alert title="消息" /></>; }
  `, tsxFile],
  ["event handler with rejection handling", `
    export function Example() {
      return <button onClick={() => { Promise.reject(new Error("failure")).catch((error: unknown) => { console.error(error); }); }}>保存</button>;
    }
  `, tsxFile],
];

for (const [name, code, file] of valid) {
  test(`configured lint accepts ${name}`, async () => {
    assert.deepEqual(await lint(code, file), []);
  });
}

test("inline directives cannot turn off a required rule", async () => {
  const messages = await lint('/* eslint-disable @typescript-eslint/no-explicit-any */\nexport const value: any = 1;');
  assert.ok(messages.some((message) => message.ruleId === "@typescript-eslint/no-explicit-any"));
  assert.ok(messages.some((message) => message.message.includes("noInlineConfig")));
});

test("CommonJS legacy entry points are also restricted", async () => {
  const messages = await lint('require("next/router");', path.join(root, "scripts/legacy-probe.cjs"));
  assert.ok(messages.some((message) => message.ruleId === "no-restricted-modules"));
});

test("personal config, generated files and nested worktrees are ignored", async () => {
  for (const filename of [
    ".pi/probe.ts", ".agents/worktrees/other/src/app/page.tsx",
    ".next/types/routes.d.ts", "next-env.d.ts", "src/types/komari-api.d.ts",
  ]) {
    assert.equal(await eslint.isPathIgnored(path.join(root, filename)), true, filename);
  }
  for (const filename of ["src/lib/http/client.ts", "tools/eslint/modern-next.mjs", ".agents/helpers/check.mjs"]) {
    assert.equal(await eslint.isPathIgnored(path.join(root, filename)), false, filename);
  }
});

test("the CLI and CI use the same zero-warning acceptance commands", async () => {
  const { scripts } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(scripts.lint, "eslint . --max-warnings 0");
  assert.equal(scripts.typecheck, "next typegen && tsc --noEmit");
  assert.equal(scripts["test:lint"], "node --test tools/eslint/*.test.mjs");
  assert.equal(scripts.check, "npm run typecheck && npm run lint && npm run test:lint");
  const workflow = await readFile(path.join(root, ".github/workflows/quality.yml"), "utf8");
  assert.match(workflow, /\n  pull_request:/);
  assert.match(workflow, /run: npm run check/);
  assert.doesNotMatch(workflow, /continue-on-error|pull_request_target/);
});

// These restrictions are semantic TypeScript checks, not guesses based on a
// variable being spelled "params" or a call's immediate parent being await.
function typeErrors(code) {
  const file = path.join(root, "src/request-contract-probe.ts");
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === file ? ts.createSourceFile(name, code, languageVersion, true) : readSource(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([file], options, host);
  return program.getSemanticDiagnostics().filter((diagnostic) => diagnostic.file?.fileName === file);
}

test("TypeScript rejects synchronous access to actual request promises", () => {
  const errors = typeErrors(`
    import { cookies, headers, draftMode } from "next/headers";
    export function read(params: Promise<{ id: string }>, searchParams: Promise<{ q: string }>) {
      return [cookies().get("session"), headers().get("accept"), draftMode().isEnabled, params.id, searchParams.q];
    }
  `);
  assert.equal(errors.length, 5, errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  assert.ok(errors.every((error) => error.code === 2339));
});

test("TypeScript accepts awaited request promises and ordinary objects", () => {
  assert.deepEqual(typeErrors(`
    import { cookies, headers, draftMode } from "next/headers";
    export async function read(params: Promise<{ id: string }>, searchParams: Promise<{ q: string }>) {
      const [cookieStore, headerStore, draft, route, query] = await Promise.all([cookies(), headers(), draftMode(), params, searchParams]);
      return [cookieStore.get("session"), headerStore.get("accept"), draft.isEnabled, route.id, query.q];
    }
    export function ordinary(params: { id: string }) { return params.id; }
  `), []);
});
