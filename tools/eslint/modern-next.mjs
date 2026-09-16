import path from "node:path";

import { importedBinding, staticString } from "./bindings.mjs";
import { objectProperties } from "./object-properties.mjs";

export const legacyModules = [
  "next/router",
  "next/head",
  "next/document",
  "next/app",
  "next/legacy/image",
].flatMap((name) => [name, `${name}.js`]);

const legacyExports = new Set([
  "getServerSideProps",
  "getStaticProps",
  "getStaticPaths",
]);
const legacyProps = {
  "next/link": new Set(["legacyBehavior", "passHref"]),
  // Next 16.2.3's emitted ForwardRefExoticComponent type drops the original
  // ImageProps JSDoc tags, so no-deprecated alone misses these JSX attributes.
  "next/image": new Set([
    "priority",
    "onLoadingComplete",
    "layout",
    "objectFit",
    "objectPosition",
    "lazyBoundary",
    "lazyRoot",
  ]),
};

const appRouterOnly = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      pages: "Pages Router files are not allowed. Use src/app route conventions.",
      export: "{{name}} is a Pages Router export. Use an App Router Server Component or Route Handler.",
      import: "{{name}} is a legacy Next.js entry point. Use App Router APIs.",
    },
  },
  create(context) {
    const filename = path.relative(context.cwd, context.filename)
      .split(path.sep).join("/");
    const isAppEntry = /^(?:src\/)?app\/(?:.*\/)?(?:page|layout|route|default)\.[cm]?[jt]sx?$/.test(filename);
    return {
      Program(node) {
        if (/^(?:src\/)?pages\//.test(filename)) {
          context.report({ node, messageId: "pages" });
        }
      },
      ImportExpression(node) {
        const name = staticString(node.source);
        if (legacyModules.includes(name)) {
          context.report({ node, messageId: "import", data: { name } });
        }
      },
      ExportNamedDeclaration(node) {
        if (!isAppEntry) return;
        const names = node.specifiers.map((specifier) => ({
          name: specifier.exported.name ?? specifier.exported.value,
          node: specifier,
        }));
        if (node.declaration?.id) {
          names.push({ name: node.declaration.id.name, node: node.declaration });
        }
        if (node.declaration?.type === "VariableDeclaration") {
          for (const declaration of node.declaration.declarations) {
            if (declaration.id.type === "Identifier") {
              names.push({ name: declaration.id.name, node: declaration.id });
            }
          }
        }
        for (const entry of names) {
          if (legacyExports.has(entry.name)) {
            context.report({ node: entry.node, messageId: "export", data: { name: entry.name } });
          }
        }
      },
    };
  },
};

const modernNextComponents = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      prop: "{{prop}} is a legacy {{component}} prop. Use the Next.js 16 component API.",
      anchor: "next/link renders an anchor itself. Remove the nested <a> element.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const binding = importedBinding(context.sourceCode, node.name);
        const component = binding?.name === "default"
          ? binding.source.replace(/\.js$/, "")
          : undefined;
        const forbidden = legacyProps[component];
        if (!forbidden) return;
        for (const attribute of node.attributes) {
          const properties = attribute.type === "JSXSpreadAttribute"
            ? objectProperties(context.sourceCode, attribute.argument)
            : [{ name: attribute.name.name, node: attribute }];
          for (const property of properties) {
            if (forbidden.has(property.name)) {
              context.report({
                node: property.node,
                messageId: "prop",
                data: { prop: property.name, component },
              });
            }
          }
        }
        if (component === "next/link") {
          const checkChildren = (children) => {
            for (const child of children) {
              if (child.type === "JSXFragment") checkChildren(child.children);
              if (
                child.type === "JSXElement" &&
                child.openingElement.name.type === "JSXIdentifier" &&
                child.openingElement.name.name === "a"
              ) {
                context.report({ node: child.openingElement, messageId: "anchor" });
              }
            }
          };
          checkChildren(node.parent.children);
        }
      },
    };
  },
};

const modernNext = {
  meta: { name: "komari-modern-next", version: "1.0.0" },
  rules: {
    "app-router-only": appRouterOnly,
    "modern-next-components": modernNextComponents,
  },
};

export default modernNext;
