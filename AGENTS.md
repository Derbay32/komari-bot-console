# AGENTS.md

## Project Runtime Contract

This project uses **Next.js 16.2.3**, **React 19**, **TypeScript**, and the **App Router**.

All generated code must target modern Next.js 16 APIs only. Do not write legacy Pages Router code, deprecated Next.js APIs, or compatibility patterns from Next.js 12/13/14 unless the existing codebase explicitly requires them and the change is limited to migration work.

When unsure, prefer the latest App Router documentation and existing project conventions over memory.

## Mandatory Next.js 16 Rules

### 1. Use App Router only

Use the `app/` directory conventions:

```txt
app/
  layout.tsx
  page.tsx
  loading.tsx
  error.tsx
  not-found.tsx
  route.ts
```

Do not create or modify these legacy Pages Router files unless explicitly asked:

```txt
pages/
pages/api/
_app.tsx
_document.tsx
getServerSideProps
getStaticProps
getStaticPaths
next/head
next/router
```

Use these modern replacements:

```ts
import { redirect, notFound } from 'next/navigation'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { Metadata } from 'next'
```

Use the Metadata API instead of manually writing `<Head>`.

Good:

```ts
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Project dashboard',
}
```

Bad:

```tsx
import Head from 'next/head'
```

### 2. Server Components are the default

In `app/`, components are Server Components by default.

Do not add `'use client'` unless the component actually needs:

- React state or effects
- browser-only APIs
- event handlers
- client-side hooks
- interactive UI behavior

Prefer this structure:

```tsx
// Server Component
export default async function Page() {
  const data = await getData()
  return <ClientWidget initialData={data} />
}
```

Only the interactive leaf should be a Client Component:

```tsx
'use client'

import { useState } from 'react'

export function ClientWidget({ initialData }: Props) {
  const [value, setValue] = useState(initialData)
  return <button onClick={() => setValue('updated')}>{value}</button>
}
```

Never turn a whole page or layout into a Client Component just to use one button.

### 3. Dynamic request APIs must be async

In Next.js 16, treat request-time APIs as asynchronous.

Always `await`:

```ts
import { cookies, headers, draftMode } from 'next/headers'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams

  const cookieStore = await cookies()
  const headerStore = await headers()
  const draft = await draftMode()

  return <div>{id}</div>
}
```

Do not write synchronous access:

```ts
const id = params.id
const theme = cookies().get('theme')
const ua = headers().get('user-agent')
```

For route handlers, type context params as async too:

```ts
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  return Response.json({ id })
}
```

### 4. Prefer generated route types when available

If route types exist, use the generated helpers instead of handwritten props.

Preferred:

```ts
export default async function Page(props: PageProps<'/users/[id]'>) {
  const { id } = await props.params
  return <div>{id}</div>
}
```

Use:

```bash
npx next typegen
```

when route type helpers are missing or stale.

### 5. Use Route Handlers, not API routes

Use `app/**/route.ts`.

Good:

```ts
export async function GET() {
  return Response.json({ ok: true })
}

export async function POST(request: Request) {
  const body = await request.json()
  return Response.json({ received: body })
}
```

Bad:

```ts
// pages/api/example.ts
export default function handler(req, res) {
  res.status(200).json({ ok: true })
}
```

Use standard Web APIs: `Request`, `Response`, `URL`, `FormData`.

Use `NextRequest` or `NextResponse` only when their extra features are needed.

### 6. Mutations should use Server Functions / Server Actions

For form mutations, prefer Server Functions.

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createPost(formData: FormData) {
  const title = String(formData.get('title') ?? '')

  if (!title) {
    throw new Error('Title is required')
  }

  await db.post.create({ data: { title } })

  revalidatePath('/posts')
  redirect('/posts')
}
```

Always validate authentication, authorization, and input inside Server Functions. They are reachable from the network and must not trust the client.

### 7. Use modern caching rules

Do not assume old implicit caching behavior.

For uncached request-time data, use normal async Server Components or Route Handlers.

For cached data in Next.js 16 with Cache Components enabled, prefer:

```ts
'use cache'

import { cacheLife, cacheTag } from 'next/cache'

export async function getPosts() {
  'use cache'
  cacheLife('hours')
  cacheTag('posts')

  return db.post.findMany()
}
```

For on-demand invalidation:

```ts
import { revalidateTag, revalidatePath } from 'next/cache'

revalidateTag('posts')
revalidatePath('/posts')
```

Avoid old or transitional cache patterns unless the existing project is not using Cache Components:

```ts
export const dynamic = 'force-static'
export const revalidate = 60
export const fetchCache = 'force-cache'
unstable_cache(...)
unstable_noStore()
```

If the project has `cacheComponents: true` in `next.config.ts`, do not use route segment cache configs such as `dynamic`, `revalidate`, or `fetchCache`.

### 8. Be explicit with fetch behavior

Do not assume `fetch()` is cached.

Dynamic request:

```ts
const res = await fetch(url, { cache: 'no-store' })
```

Explicit cached request:

```ts
const res = await fetch(url, {
  cache: 'force-cache',
  next: {
    tags: ['posts'],
  },
})
```

Time-based revalidation only when the project is not using Cache Components or the surrounding code already uses this model:

```ts
const res = await fetch(url, {
  next: {
    revalidate: 3600,
  },
})
```

### 9. Use Suspense for dynamic or uncached islands

When using Cache Components, keep static shell and dynamic data separated.

Good:

```tsx
import { Suspense } from 'react'

export default function Page() {
  return (
    <>
      <StaticHeader />
      <Suspense fallback={<p>Loading...</p>}>
        <DynamicPanel />
      </Suspense>
    </>
  )
}
```

Do not access uncached data high in the tree if only a small part of the page needs it.

### 10. Use `next/link` correctly

Use modern `<Link>` directly. Do not nest `<a>` inside it.

Good:

```tsx
import Link from 'next/link'

export function Nav() {
  return <Link href="/dashboard">Dashboard</Link>
}
```

Bad:

```tsx
<Link href="/dashboard">
  <a>Dashboard</a>
</Link>
```

Do not use `legacyBehavior`.

### 11. Use `next/image` correctly

Use `next/image` for optimized images.

```tsx
import Image from 'next/image'

export function Avatar() {
  return (
    <Image
      src="/avatar.png"
      alt="User avatar"
      width={96}
      height={96}
    />
  )
}
```

Always provide meaningful `alt`.

Do not use removed legacy props such as:

```tsx
layout="fill"
objectFit="cover"
objectPosition="center"
```

Use modern props and CSS instead:

```tsx
<Image
  src="/hero.png"
  alt="Hero image"
  fill
  className="object-cover object-center"
/>
```

### 12. Use `next/navigation`, not `next/router`

Client navigation:

```tsx
'use client'

import { useRouter } from 'next/navigation'

export function Button() {
  const router = useRouter()

  return <button onClick={() => router.push('/dashboard')}>Open</button>
}
```

Server redirects:

```ts
import { redirect } from 'next/navigation'

export default async function Page() {
  redirect('/login')
}
```

Do not import from `next/router`.

### 13. Use environment variables safely

Server-only secrets must never be exposed to Client Components.

Allowed on the server:

```ts
process.env.DATABASE_URL
process.env.API_SECRET
```

Allowed in the browser only when intentionally public:

```ts
process.env.NEXT_PUBLIC_APP_URL
```

Do not pass secrets to Client Components.

### 14. TypeScript requirements

Write TypeScript-first code.

Avoid:

```ts
any
// @ts-ignore
```

Prefer:

```ts
unknown
satisfies
zod schemas
explicit return types for exported functions
```

Use `import type` for type-only imports.

```ts
import type { Metadata } from 'next'
```

### 15. Do not generate deprecated or legacy patterns

Never introduce these unless the task is explicitly to migrate/remove them:

```ts
getServerSideProps
getStaticProps
getStaticPaths
NextApiRequest
NextApiResponse
next/head
next/router
pages/api
_app.tsx
_document.tsx
Link legacyBehavior
<Link><a /></Link>
cookies() without await
headers() without await
draftMode() without await
params.id without awaiting params
searchParams.foo without awaiting searchParams
unstable_cache for new Cache Components code
unstable_noStore for new Cache Components code
route segment cache configs when cacheComponents is enabled
```

### 16. Before writing code, inspect the project

Before implementing a change:

1. Check `package.json` for versions and scripts.
2. Check `next.config.ts` or `next.config.mjs`.
3. Check whether `cacheComponents` is enabled.
4. Check whether the project uses `src/app` or `app`.
5. Check existing component conventions.
6. Check whether route type helpers already exist.
7. Match the existing lint, formatting, and import style.

Do not blindly generate generic Next.js snippets.

### 17. Migration behavior

When touching old code, migrate it toward Next.js 16 patterns.

Examples:

- `next/router` → `next/navigation`
- `pages/api/*` → `app/**/route.ts`
- `next/head` → Metadata API
- synchronous `params` → async `params`
- synchronous `cookies()` / `headers()` → awaited calls
- `<Link><a /></Link>` → direct `<Link>`
- old Image props → modern `Image` props plus CSS
- legacy cache configs → `"use cache"`, `cacheLife`, `cacheTag` when Cache Components are enabled

### 18. Quality gate before finishing

Before returning code, verify:

- No imports from `next/router`
- No imports from `next/head`
- No new files under `pages/`
- No `getServerSideProps`, `getStaticProps`, or `getStaticPaths`
- No synchronous `cookies()`, `headers()`, or `draftMode()`
- No direct synchronous `params.xxx` or `searchParams.xxx`
- No `legacyBehavior`
- No `<Link><a /></Link>`
- No removed `next/image` legacy props
- No cache route segment config if `cacheComponents: true`
- Server secrets are not passed into Client Components
- Client Components are minimal and necessary
- TypeScript passes without `any` or `@ts-ignore`

## Preferred Implementation Style

Prefer small, composable files.

Prefer Server Components for data loading.

Prefer Client Components only for interaction.

Prefer Web Platform APIs in Route Handlers.

Prefer explicit caching.

Prefer explicit validation.

Prefer project-local utilities over inventing new abstractions.

Prefer readable code over clever code.

## Final Instruction

When generating code for this project, assume **Next.js 16.2.3 App Router**. New code must be modern, typed, async-safe, cache-aware, and free of deprecated Next.js APIs.