import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'

import {
  getAdminLoginPath,
  isBasicAuthFallbackEnabled,
  isGoogleAdminAuthConfigured,
} from '@/lib/admin-auth'

export const metadata: Metadata = {
  title: 'Admin sign in',
  description: 'Private sign-in for the internal admin workspace.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0,
    },
  },
}

function getErrorMessage(error?: string) {
  switch (error) {
    case 'config':
      return 'Google admin auth is not fully configured yet.'
    case 'state':
      return 'The sign-in flow expired or could not be verified. Please try again.'
    case 'denied':
      return 'This Google account is not on the admin allowlist.'
    case 'oauth':
      return 'Google sign-in did not complete successfully. Please try again.'
    default:
      return null
  }
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; returnTo?: string; next?: string }>
}) {
  const params = searchParams ? await searchParams : undefined
  const errorMessage = getErrorMessage(params?.error)
  const rawReturn = params?.returnTo ?? params?.next
  const returnTo = rawReturn && rawReturn.startsWith('/admin') ? rawReturn : undefined
  const googleReady = isGoogleAdminAuthConfigured()
  const basicFallback = isBasicAuthFallbackEnabled()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 md:px-6 md:py-12">
      <div className="grid w-full gap-6 xl:grid-cols-[minmax(0,1.1fr)_30rem]">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#07111f]/95 px-6 py-7 shadow-[0_30px_80px_rgba(3,8,20,0.45)] md:px-8 md:py-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.16),transparent_34%),radial-gradient(circle_at_80%_0%,rgba(129,140,248,0.16),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_38%)]" />
          <div className="relative space-y-8">
            <div className="space-y-4">
              <div className="inline-flex min-h-9 items-center rounded-full border border-sky-300/18 bg-sky-300/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100/88">
                Private admin access
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-white md:text-[3.4rem] md:leading-[1.02]">
                  Enter the Jumbo internal command deck.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-300 md:text-[15px]">
                  This workspace is reserved for approved internal operators. It is blocked from indexing, protected by
                  Google sign-in, and designed for editorial and operational work that should stay off the public web.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FeatureTile
                icon={<LockKeyhole className="size-4 text-sky-100" />}
                title="Private by default"
                body="Noindex and robots protection stay in place across admin routes."
              />
              <FeatureTile
                icon={<ShieldCheck className="size-4 text-sky-100" />}
                title="Approved accounts"
                body="Google allowlisting governs who can enter the workspace."
              />
              <FeatureTile
                icon={<Sparkles className="size-4 text-sky-100" />}
                title="Operational focus"
                body="Built for internal editing, approvals, and future system modules."
              />
            </div>

            <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-4 text-sm leading-6 text-slate-300">
              Main routes: <Link href={getAdminLoginPath()} className="font-medium text-white underline underline-offset-4">/admin/login</Link>,{' '}
              <Link href="/admin" className="font-medium text-white underline underline-offset-4">/admin</Link>, and{' '}
              <Link href="/admin/seo-llm" className="font-medium text-white underline underline-offset-4">/admin/seo-llm</Link>.
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[#081220]/92 p-6 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-7">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Authentication</p>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">Sign in to continue</h2>
              <p className="text-sm leading-6 text-slate-300">
                Use the approved Google account for this workspace. Access remains private and is not indexed.
              </p>
            </div>

            {errorMessage ? (
              <div className="rounded-[1.35rem] border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-50">
                {errorMessage}
              </div>
            ) : null}

            {googleReady ? (
              <a
                href={returnTo ? `/api/admin/auth/google/start?returnTo=${encodeURIComponent(returnTo)}` : '/api/admin/auth/google/start'}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-sky-300/16 bg-sky-300/12 px-5 py-3 text-sm font-medium text-sky-50 transition hover:bg-sky-300/18"
              >
                Continue with Google
                <ArrowRight className="size-4" />
              </a>
            ) : (
              <div className="rounded-[1.4rem] border border-dashed border-white/12 bg-white/[0.035] p-4 text-sm leading-6 text-slate-300">
                Google admin auth is not fully configured yet. Add the required env vars before using Google sign-in.
              </div>
            )}

            {basicFallback ? (
              <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-slate-300">
                Basic Auth fallback is enabled as a temporary safety net. Once Google login is verified, it can be turned off.
              </div>
            ) : null}

            <div className="rounded-[1.4rem] border border-white/8 bg-[#0b1728]/88 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Access notes</div>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                <li>• Internal-only route with robots blocking and noindex metadata.</li>
                <li>• Existing auth flow remains unchanged — this is a visual redesign only.</li>
                <li>• Once inside, POI text is the current live editorial workflow.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function FeatureTile({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">{icon}</div>
      <div className="mt-3 text-sm font-medium text-white">{title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-300">{body}</p>
    </div>
  )
}
