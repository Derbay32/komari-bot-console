/**
 * Next.js server startup hook. Only the Node.js runtime performs credential
 * initialization; the production build and edge runtime never open the
 * console database or emit an administrator password.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const { bootstrapConsoleAuthentication } = await import(
    "./lib/server/auth-bootstrap"
  );

  await bootstrapConsoleAuthentication();
}
