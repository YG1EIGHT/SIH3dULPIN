
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
type LoginRole = "VIEWER" | "SURVEYOR";

export default function LoginPage() {
  const router = useRouter();

 const [loginRole, setLoginRole] = useState<LoginRole>("VIEWER");
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
  email,
  password,
  role: loginRole,
}),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0b1220] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl lg:grid lg:grid-cols-[1.15fr_0.85fr]">

        {/* LEFT — 3D GIS Visual */}
        <section className="relative hidden min-h-[720px] overflow-hidden bg-[#101a2d] lg:block">

          {/* Grid */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
              backgroundSize: "42px 42px",
            }}
          />

          {/* Glow */}
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14">

            {/* Brand */}
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-white">
                  3D
                </div>

                <div>
                  <p className="text-lg font-bold tracking-wide text-white">
                    3D ULPIN
                  </p>
                  <p className="text-xs text-slate-400">
                    Vertical Property Mapping
                  </p>
                </div>
              </div>
            </div>

            {/* Building Illustration */}
            <div className="relative flex flex-1 items-center justify-center">

              <div className="relative mt-8 h-[360px] w-[300px]">

                {/* Ground plane */}
                <div className="absolute bottom-4 left-1/2 h-20 w-72 -translate-x-1/2 rotate-[-8deg] rounded-xl border border-emerald-400/20 bg-emerald-400/5" />

                {/* Building */}
                <div className="absolute bottom-16 left-1/2 h-[280px] w-48 -translate-x-1/2 rounded-sm border border-emerald-300/30 bg-slate-800/90 shadow-[0_0_50px_rgba(16,185,129,0.12)]">

                  {/* Floors */}
                  {[0, 1, 2, 3, 4, 5].map((floor) => (
                    <div
                      key={floor}
                      className="absolute left-0 right-0 border-t border-emerald-400/25"
                      style={{
                        bottom: `${floor * 16.66}%`,
                      }}
                    >
                      <div className="absolute -left-12 -top-2 text-[9px] text-emerald-400/70">
                        F{floor + 1}
                      </div>
                    </div>
                  ))}

                  {/* Windows */}
                  <div className="grid h-full grid-cols-3 gap-3 p-5">
                    {Array.from({ length: 18 }).map((_, index) => (
                      <div
                        key={index}
                        className="rounded-sm border border-cyan-300/10 bg-cyan-300/5"
                      />
                    ))}
                  </div>

                  {/* Vertical parcel line */}
                  <div className="absolute -right-12 top-0 h-full border-r border-dashed border-emerald-400/40" />
                </div>

                {/* Elevation marker */}
                <div className="absolute right-0 top-10 text-[10px] text-slate-500">
                  +18.40 m
                </div>

                {/* Coordinate markers */}
                <div className="absolute bottom-0 left-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] text-slate-400 backdrop-blur">
                  18.4418° N
                  <br />
                  73.8317° E
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="max-w-lg">
              <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
                Beyond 2D boundaries
              </p>

              <h2 className="text-3xl font-semibold leading-tight text-white xl:text-4xl">
                Visualize property in
                <span className="text-emerald-400"> three dimensions.</span>
              </h2>

              <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
                A unified platform for visualizing buildings, floors, units,
                parcels and vertical property information.
              </p>
            </div>
          </div>
        </section>

        {/* RIGHT — Login */}
        <section className="flex min-h-[720px] items-center justify-center bg-[#f8faf9] px-6 py-12 sm:px-12">

          <div className="w-full max-w-md">

            {/* Mobile branding */}
            <div className="mb-10 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
                  3D
                </div>

                <div>
                  <p className="font-bold text-slate-900">3D ULPIN</p>
                  <p className="text-xs text-slate-500">
                    Vertical Property Mapping
                  </p>
                </div>
              </div>
            </div>

            {/* Heading */}
            <div className="mb-8">
              <p className="mb-2 text-sm font-medium text-emerald-700">
                Welcome back
              </p>

              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Sign in to your account
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Access the 3D ULPIN property mapping platform.
              </p>
            </div>
             {/* Login Role Toggle */}
<div className="mb-6">
  <p className="mb-2 text-sm font-medium text-slate-700">
    Sign in as
  </p>

  <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
    <button
      type="button"
      onClick={() => {
        setLoginRole("VIEWER");
        setError("");
      }}
      className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
        loginRole === "VIEWER"
          ? "bg-white text-emerald-700 shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      Viewer
    </button>

    <button
      type="button"
      onClick={() => {
        setLoginRole("SURVEYOR");
        setError("");
      }}
      className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
        loginRole === "SURVEYOR"
          ? "bg-white text-emerald-700 shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      Surveyor
    </button>
  </div>

  <p className="mt-2 text-xs text-slate-500">
    {loginRole === "VIEWER"
      ? "For registered public users."
      : "For authorized government surveyors."}
  </p>
</div>
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Email address
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              {/* Password */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Password
                  </label>

                  <button
                    type="button"
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    Forgot password?
                  </button>
                </div>

                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 pr-20 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>

            {/* Signup */}
            <div className="mt-8 text-center text-sm text-slate-500">
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => router.push("/signup")}
                className="font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Create viewer account
              </button>
            </div>

            {/* Surveyor notice */}
            <div className="mt-8 border-t border-slate-200 pt-6">
              <div className="rounded-xl bg-slate-100 px-4 py-3.5">
                <p className="text-xs font-semibold text-slate-700">
                  Government Surveyor Access
                </p>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Surveyor accounts are provided through authorized government
                  credentials. Public registration is not available.
                </p>
              </div>
            </div>

            <p className="mt-8 text-center text-[11px] text-slate-400">
              3D ULPIN • Secure property information platform
            </p>

          </div>
        </section>
      </div>
    </main>
  );
}

