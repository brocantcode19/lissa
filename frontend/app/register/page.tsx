"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName,  setFullName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)  { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email_address: email, password }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Registration failed."); }
      router.push("/login?registered=true");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  };

  return (
    <main className="flex h-screen overflow-hidden font-sans">

      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-10 py-16 relative"
        style={{ background: "radial-gradient(ellipse at 40% 40%, #3D1010 0%, #1A0606 65%)" }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)" }} />

        <div className="relative text-center flex flex-col items-center">
          <div className="mb-7">
            <img src="/ldcu-crest.png" alt="LdCU seal"
              className="w-36 h-36 object-contain"
              onError={(e) => { (e.target as HTMLElement).style.display = "none"; }} />
          </div>
          <h1 className="font-serif font-bold italic text-5xl text-white mb-2 tracking-wide">LISSA</h1>
          <p className="text-white/60 text-sm tracking-wider">Liceo Student Support Assistant</p>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────── */}
      <div className="w-[480px] bg-white flex flex-col justify-center px-14 py-16 shrink-0 overflow-y-auto">

        <h2 className="font-serif font-bold italic text-4xl text-foreground mb-2">
          Create Account
        </h2>
        <p className="text-muted-foreground text-sm mb-8">
          Register to access LISSA
        </p>

        <form onSubmit={handleRegister} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-foreground">Full Name</label>
            <Input
              type="text" value={fullName} required autoComplete="name"
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan dela Cruz"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-foreground">Email Address</label>
            <Input
              type="email" value={email} required autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@liceo.edu.ph"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-foreground">Password</label>
            <Input
              type="password" value={password} required minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Atleast 8 characters"
              autoComplete="new-password"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-foreground">Confirm Password</label>
            <Input
              type="password" value={confirm} required
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="mt-1 h-12 text-base">
            {loading ? "Creating account…" : "Create Account"}
          </Button>
        </form>

        <p className="text-center text-sm text-foreground font-medium mt-6">
          Already have an account?{" "}
          <a href="/login" className="text-gold underline font-medium hover:text-gold-muted">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
