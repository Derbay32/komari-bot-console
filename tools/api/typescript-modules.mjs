import { readFileSync } from "node:fs";

import ts from "typescript";

/**
 * Load a repository TypeScript module as an in-memory ESM module. Runtime
 * imports must be mapped to absolute URLs so the data URL module can resolve
 * them without a Next.js/TypeScript loader.
 */
export function loadTypeScriptModule(relativePath, imports = {}) {
  const moduleUrl = new URL(`../../${relativePath}`, import.meta.url);
  const source = readFileSync(moduleUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: relativePath,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const rewritten = outputText.replace(
    /\b(from|import)\s*(["'])([^"']+)\2/g,
    (_match, keyword, _quote, specifier) => {
      const target = imports[specifier];
      if (!target) {
        throw new Error(
          `No runtime module mapping for "${specifier}" imported by ${relativePath}`,
        );
      }

      return `${keyword} ${JSON.stringify(target)}`;
    },
  );

  return toDataUrl(`${rewritten}\n//# sourceURL=${relativePath}`);
}

export function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
