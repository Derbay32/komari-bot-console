import { describe, it } from "node:test";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./modern-next.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const { "app-router-only": appRouterOnly, "modern-next-components": modernNextComponents } =
  plugin.rules;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

// Filenames are resolved against process.cwd(), mirroring how the rule
// resolves context.filename against context.cwd.
const rootFile = (relativePath) =>
  path.join(process.cwd(), ...relativePath.split("/"));

const srcAppPage = rootFile("src/app/page.tsx");

// ---------------------------------------------------------------------------
// app-router-only
// ---------------------------------------------------------------------------

ruleTester.run("app-router-only", appRouterOnly, {
  valid: [
    {
      name: "accepts an App Router page entry",
      filename: srcAppPage,
      code: "export default function Page() { return <main>ok</main>; }",
    },
    {
      name: "accepts an empty App Router entry",
      filename: srcAppPage,
      code: "",
    },
    {
      name: "accepts a components/pages directory that is not the Pages Router root",
      filename: rootFile("src/components/pages/x.tsx"),
      code: "export default function PagesIndex() { return null; }",
    },
    {
      name: "allows next/navigation static and dynamic imports",
      filename: srcAppPage,
      code: `
        import { useRouter } from "next/navigation";
        export async function loadNavigation() {
          useRouter;
          return import("next/navigation");
        }
        export default function Page() { return null; }
      `,
    },
    {
      name: "allows local helpers named like Pages Router exports when not exported",
      filename: srcAppPage,
      code: `
        function getServerSideProps() { return {}; }
        const getStaticProps = () => ({});
        const getStaticPaths = () => ({});
        export default function Page() {
          return getServerSideProps() && getStaticProps() && getStaticPaths() && null;
        }
      `,
    },
    {
      name: "allows unrelated exported helper names in an app entry",
      filename: srcAppPage,
      code: `
        export const loadDashboardData = () => [];
        export function formatTitle() { return ""; }
        export default function Page() { return null; }
      `,
    },
    {
      name: "allows re-exporting a local helper under an unrelated alias",
      filename: srcAppPage,
      code: `
        const load = () => ({});
        export { load as getPosts };
        export default function Page() { return null; }
      `,
    },
  ],
  invalid: [
    {
      name: "rejects an empty Pages Router file",
      filename: rootFile("pages/x.tsx"),
      code: "",
      errors: [{ messageId: "pages" }],
    },
    {
      name: "rejects an empty Pages Router API route under src/",
      filename: rootFile("src/pages/api/x.ts"),
      code: "",
      errors: [{ messageId: "pages" }],
    },
    {
      name: "rejects an exported getServerSideProps function in an app entry",
      filename: srcAppPage,
      code: "export function getServerSideProps() { return { props: {} }; }",
      errors: [{ messageId: "export", data: { name: "getServerSideProps" } }],
    },
    {
      name: "rejects an exported getStaticProps binding in a route handler entry",
      filename: rootFile("src/app/users/route.ts"),
      code: "export const getStaticProps = async () => ({ props: {} });",
      errors: [{ messageId: "export", data: { name: "getStaticProps" } }],
    },
    {
      name: "rejects an exported getStaticPaths function in an app entry",
      filename: srcAppPage,
      code: "export async function getStaticPaths() { return { paths: [] }; }",
      errors: [{ messageId: "export", data: { name: "getStaticPaths" } }],
    },
    {
      name: "rejects a local helper re-exported under a Pages Router alias",
      filename: srcAppPage,
      code: `
        function load() { return {}; }
        export { load as getStaticProps };
      `,
      errors: [{ messageId: "export", data: { name: "getStaticProps" } }],
    },
    {
      name: "rejects every Pages Router alias in a mixed export specifier list",
      filename: srcAppPage,
      code: `
        const a = () => ({});
        const b = () => ({});
        export { a as getServerSideProps, b as getStaticPaths };
      `,
      errors: [
        { messageId: "export", data: { name: "getServerSideProps" } },
        { messageId: "export", data: { name: "getStaticPaths" } },
      ],
    },
    {
      name: "rejects literal dynamic imports of every legacy Next.js entry point",
      filename: srcAppPage,
      code: `
        export async function loadLegacy() {
          await import("next/router");
          await import("next/head");
          await import("next/document");
          await import("next/app");
          await import("next/legacy/image");
        }
      `,
      errors: [
        { messageId: "import", data: { name: "next/router" } },
        { messageId: "import", data: { name: "next/head" } },
        { messageId: "import", data: { name: "next/document" } },
        { messageId: "import", data: { name: "next/app" } },
        { messageId: "import", data: { name: "next/legacy/image" } },
      ],
    },
    {
      name: "rejects literal dynamic imports of the .js variants of legacy entry points",
      filename: srcAppPage,
      code: `
        export async function loadLegacyJs() {
          await import("next/router.js");
          await import("next/head.js");
          await import("next/document.js");
          await import("next/app.js");
          await import("next/legacy/image.js");
        }
      `,
      errors: [
        { messageId: "import", data: { name: "next/router.js" } },
        { messageId: "import", data: { name: "next/head.js" } },
        { messageId: "import", data: { name: "next/document.js" } },
        { messageId: "import", data: { name: "next/app.js" } },
        { messageId: "import", data: { name: "next/legacy/image.js" } },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// modern-next-components
// ---------------------------------------------------------------------------

ruleTester.run("modern-next-components", modernNextComponents, {
  valid: [
    {
      name: "allows a modern Link with direct text children",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/dashboard">Dashboard</Link>;
        }
      `,
    },
    {
      name: "allows a modern Image with fill and style",
      filename: rootFile("src/components/avatar.tsx"),
      code: `
        import Image from "next/image";
        export default function Avatar() {
          return <Image src="/avatar.png" alt="User avatar" fill style={{ objectFit: "cover" }} />;
        }
      `,
    },
    {
      name: "allows modern props arriving through a spread object",
      filename: rootFile("src/components/avatar.tsx"),
      code: `
        import Image from "next/image";
        const imageProps = { src: "/a.png", alt: "a", fill: true };
        export default function Avatar() {
          return <Image {...imageProps} />;
        }
      `,
    },
    {
      name: "allows a legal const alias of next/link used with modern props",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        const NavLink = Link;
        export default function Nav() {
          return <NavLink href="/x">ok</NavLink>;
        }
      `,
    },
    {
      name: "allows a custom local Link component with same-named props and a nested anchor",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        function Link({ legacyBehavior, passHref, children }) {
          return <span data-legacy={legacyBehavior} data-pass={passHref}>{children}</span>;
        }
        export default function Nav() {
          return <Link legacyBehavior passHref><a href="/x">x</a></Link>;
        }
      `,
    },
    {
      name: "allows a custom local Image component with same-named props",
      filename: rootFile("src/components/figure.tsx"),
      code: `
        function Image({ layout, objectFit }) {
          return <img alt="" data-layout={layout} data-fit={objectFit} />;
        }
        export default function Figure() {
          return <Image layout="fill" objectFit="cover" />;
        }
      `,
    },
    {
      name: "allows same-named props when the import is shadowed by a parameter",
      filename: rootFile("src/components/gallery.tsx"),
      code: `
        import Image from "next/image";
        Image;
        export function Gallery({ Image }) {
          return <Image layout="fill" objectFit="cover" />;
        }
      `,
    },
    {
      name: "allows an unrelated imported component named Image",
      filename: rootFile("src/components/gallery.tsx"),
      code: `
        import Image from "some-ui-kit";
        export default function Gallery() {
          return <Image layout="fill" objectFit="cover" />;
        }
      `,
    },
    {
      name: "allows unrelated namespaced components, including namespace.default",
      filename: rootFile("src/components/gallery.tsx"),
      code: `
        import * as UI from "some-ui-kit";
        export default function Gallery() {
          return (
            <>
              <UI.Image layout="fill" />
              <UI.default objectFit="cover" />
            </>
          );
        }
      `,
    },
  ],
  invalid: [
    {
      name: "rejects Link legacyBehavior together with a direct nested anchor",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/x" legacyBehavior><a>x</a></Link>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "legacyBehavior", component: "next/link" } },
        { messageId: "anchor" },
      ],
    },
    {
      name: "rejects Link passHref",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/x" passHref>text</Link>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "passHref", component: "next/link" } },
      ],
    },
    {
      name: "rejects a direct nested anchor inside Link",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/x"><a>x</a></Link>;
        }
      `,
      errors: [{ messageId: "anchor" }],
    },
    {
      name: "rejects a nested anchor hidden inside a fragment inside Link",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/x"><><a>x</a></></Link>;
        }
      `,
      errors: [{ messageId: "anchor" }],
    },
    {
      name: "rejects every nested anchor, direct and inside fragments",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/x"><a>one</a><><a>two</a></></Link>;
        }
      `,
      errors: [{ messageId: "anchor" }, { messageId: "anchor" }],
    },
    {
      name: "rejects legacy props on a renamed default import of next/link",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import NextLink from "next/link";
        export default function Nav() {
          return <NextLink href="/x" legacyBehavior>x</NextLink>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "legacyBehavior", component: "next/link" } },
      ],
    },
    {
      name: "rejects legacy props on a named default import of next/link",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import { default as Link } from "next/link";
        export default function Nav() {
          return <Link href="/x" passHref>x</Link>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "passHref", component: "next/link" } },
      ],
    },
    {
      name: "rejects legacy props on a namespace .default usage of next/link",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import * as Next from "next/link";
        export default function Nav() {
          return <Next.default href="/x" legacyBehavior>x</Next.default>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "legacyBehavior", component: "next/link" } },
      ],
    },
    {
      name: "rejects legacy props through a const alias of next/link",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        const NavLink = Link;
        export default function Nav() {
          return <NavLink href="/x" passHref>x</NavLink>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "passHref", component: "next/link" } },
      ],
    },
    {
      name: "rejects every legacy Image prop",
      filename: rootFile("src/components/photo.tsx"),
      code: `
        import Image from "next/image";
        const rootRef = { current: null };
        export default function Photo() {
          return (
            <Image
              src="/x.png"
              alt="x"
              layout="fill"
              objectFit="cover"
              objectPosition="center"
              lazyBoundary="200px"
              lazyRoot={rootRef}
            />
          );
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "layout", component: "next/image" } },
        { messageId: "prop", data: { prop: "objectFit", component: "next/image" } },
        { messageId: "prop", data: { prop: "objectPosition", component: "next/image" } },
        { messageId: "prop", data: { prop: "lazyBoundary", component: "next/image" } },
        { messageId: "prop", data: { prop: "lazyRoot", component: "next/image" } },
      ],
    },
    {
      name: "rejects legacy props hidden in an inline object JSX spread",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        export default function Nav() {
          return <Link href="/x" {...{ legacyBehavior: true }}>x</Link>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "legacyBehavior", component: "next/link" } },
      ],
    },
    {
      name: "rejects legacy props arriving through a const object spread",
      filename: rootFile("src/components/photo.tsx"),
      code: `
        import Image from "next/image";
        const imageProps = { layout: "fill" };
        export default function Photo() {
          return <Image src="/x.png" alt="x" {...imageProps} />;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "layout", component: "next/image" } },
      ],
    },
    {
      name: "rejects legacy props arriving through a nested spread chain",
      filename: rootFile("src/components/photo.tsx"),
      code: `
        import Image from "next/image";
        const base = { objectFit: "cover" };
        const merged = { ...base, alt: "x" };
        export default function Photo() {
          return <Image src="/x.png" {...merged} />;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "objectFit", component: "next/image" } },
      ],
    },
    {
      name: "rejects legacy props in a spread object guarded by TS satisfies",
      filename: rootFile("src/components/photo.tsx"),
      code: `
        import Image from "next/image";
        const imageProps = { objectPosition: "center" } satisfies Record<string, string>;
        export default function Photo() {
          return <Image src="/x.png" alt="x" {...imageProps} />;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "objectPosition", component: "next/image" } },
      ],
    },
    {
      name: "rejects legacy props in a spread object with a TS as assertion",
      filename: rootFile("src/components/nav.tsx"),
      code: `
        import Link from "next/link";
        const linkProps = { passHref: true } as const;
        export default function Nav() {
          return <Link href="/x" {...linkProps}>x</Link>;
        }
      `,
      errors: [
        { messageId: "prop", data: { prop: "passHref", component: "next/link" } },
      ],
    },
  ],
});

const imageSpread = (declarations) => `
  import Image from "next/image";
  ${declarations}
  export function Example() { return <Image alt="x" {...imageProps} />; }
`;

ruleTester.run("modern-next-components destructuring regressions", modernNextComponents, {
  valid: [
    imageSpread('const { imageProps } = { imageProps: {src:"/x", width:10, height:10}, layout:"grid" };'),
    imageSpread('const { opts: imageProps } = { opts: {src:"/x", fill:true}, priority:true };'),
    imageSpread('const { opts: { imageProps } } = { opts: { imageProps:{src:"/x", fill:true}, layout:"grid" } };'),
    imageSpread('const { layout, ...imageProps } = { src:"/x", fill:true, layout:"grid" };'),
    imageSpread('const { imageProps = { priority:true } } = { imageProps:{ src:"/x", fill:true } };'),
    imageSpread('const { imageProps } = { imageProps:{ priority:true }, ...unknownOptions };'),
    imageSpread('const { imageProps } = { ...{imageProps:{ priority:true }}, imageProps:{ src:"/x", fill:true } };'),
    imageSpread('const { imageProps } = unknownOptions;'),
  ],
  invalid: [
    'const { imageProps } = { imageProps: {src:"/x", width:10, height:10, priority:true} };',
    'const options = { opts: {priority:true} }; const { opts: selected } = options; const imageProps = selected;',
    'const { opts: { imageProps } } = { opts: {imageProps:{priority:true}} };',
    'const { src, ...imageProps } = { src:"/x", priority:true };',
    'const { imageProps = { priority:true } } = {};',
    'const { ["opts"]: imageProps } = { opts:{priority:true} };',
    'const { imageProps } = { ...unknownOptions, imageProps:{priority:true} };',
  ].map((declarations) => ({
    code: imageSpread(declarations),
    errors: [{ messageId: "prop", data: { prop: "priority", component: "next/image" } }],
  })),
});

ruleTester.run("app-router-only template import regressions", appRouterOnly, {
  valid: [
    'export const load = () => import(`next/navigation`);',
    'export const load = (name) => import(`next/${name}`);',
  ],
  invalid: ["next/router", "next/head.js", "next/legacy/image"].map((name) => ({
    code: `export const load = () => import(\`${name}\`);`,
    errors: [{ messageId: "import", data: { name } }],
  })),
});
