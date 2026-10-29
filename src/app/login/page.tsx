import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = {
  title: "登录 | Komari 管理后台",
};

export default function LoginPage() {
  return (
    <main
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <section
        style={{
          backdropFilter: "blur(16px)",
          background: "var(--panel-bg)",
          border: "1px solid var(--border-soft)",
          borderRadius: 24,
          boxShadow: "var(--card-shadow)",
          maxWidth: 420,
          padding: 32,
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <BrandLogo size={44} />
          <div>
            <h1
              style={{
                color: "var(--text-main)",
                fontSize: 20,
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              Komari Bot Console
            </h1>
            <p
              style={{
                color: "var(--text-subtle)",
                fontSize: 13,
                margin: "2px 0 0",
              }}
            >
              请输入管理员账号登录
            </p>
          </div>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
