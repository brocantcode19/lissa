"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginContent() {
  const router  = useRouter();
  const params  = useSearchParams();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (params.get("registered") === "true")
      setSuccess("Account created successfully. Please sign in.");
  }, [params]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/proxy/auth/login", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_address: email, password }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Login failed"); }
      const data = await res.json();
      router.push(data.role === "admin" ? "/admin" : "/chat");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  };

  return (
    <main className="flex h-screen overflow-hidden font-sans">

      {/* ── Left panel — LdCU branding ─────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-10 py-16 relative"
        style={{ background: "radial-gradient(ellipse at 40% 40%, #3D1010 0%, #1A0606 65%)" }}
      >
        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)" }} />

        <div className="relative text-center flex flex-col items-center">
          {/* LdCU Crest */}
          <div className="mb-7">
            <Image
              src="/ldcu-crest.png"
              alt="Liceo de Cagayan University seal"
              width={144}
              height={144}
              className="w-36 h-36 object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
                const fb = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                if (fb) fb.style.display = "flex";
              }}
            />
            {/* Fallback */}
            <div className="hidden w-36 h-36 mx-auto rounded-full border-4 border-gold/60 bg-gold/10 items-center justify-center flex-col gap-1">
              <span className="text-4xl text-gold">⚖</span>
              <span className="text-xs text-gold font-bold tracking-widest">LdCU</span>
            </div>
          </div>

          <h1 className="font-serif font-bold italic text-5xl text-white mb-2 tracking-wide">
            LISSA
          </h1>
          <p className="text-white/60 text-sm tracking-wider">
            Liceo Student Support Assistant
          </p>
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────────────────── */}
      <div className="w-[480px] bg-white flex flex-col justify-center px-14 py-16 shrink-0">

        <h2 className="font-serif font-bold italic text-4xl text-foreground mb-2">
          Welcome back
        </h2>
        <p className="text-muted-foreground text-sm mb-10">
          Sign in to access your student support
        </p>

        {success && (
          <div className="mb-5 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            {success}
          </div>
        )}

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-foreground">Email Address</label>
            <Input
              type="email" value={email} required autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@liceo.edu.ph"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-foreground">Password</label>
            <Input
              type="password" value={password} required
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="mt-1 h-12 text-base">
            {loading ? "Signing in…" : "Sign In"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Don&apos;t have an account?{" "}
          <a href="/register" className="text-gold font-semibold hover:underline">
            Register
          </a>
        </p>

        <div className="mt-10 pt-6 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">Liceo de Cagayan University</p>
          <p className="text-xs text-muted-foreground">College of Information Technology &amp; Computing</p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading login...</div>}>
      <LoginContent />
    </Suspense>
  );
}
