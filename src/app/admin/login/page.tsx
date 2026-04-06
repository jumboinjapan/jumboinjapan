import type { Metadata } from 'next'
import Link from 'next/link'

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
  searchParams?: Promise<{ error?: string }>
}) {
  const params = searchParams ? await searchParams : undefined
  const errorMessage = getErrorMessage(params?.error)
  const googleReady = isGoogleAdminAuthConfigured()
  const basicFallback = isBasicAuthFallbackEnabled()

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-4 py-10 md:px-6">
      <div className="w-full rounded-[2rem] border border-black/10 bg-white p-6 shadow-sm md:p-8">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Private admin</p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-black">Sign in to the internal workspace</h1>
          <p className="max-w-xl text-sm leading-6 text-black/62">
            This area is private, blocked from indexing, and intended only for approved internal accounts.
          </p>
        </div>

        {errorMessage ? (
          <div className="mt-6 rounded-[1.4rem] border border-black/10 bg-black px-4 py-3 text-sm text-white">{errorMessage}</div>
        ) : null}

        <div className="mt-8 space-y-4">
          {googleReady ? (
            <a
              href="/api/admin/auth/google/start"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-black/90"
            >
              Continue with Google
            </a>
          ) : (
            <div className="rounded-[1.4rem] border border-dashed border-black/12 bg-black/[0.02] p-4 text-sm leading-6 text-black/62">
              Google admin auth is not fully configured yet. Add the required env vars before using Google sign-in.
            </div>
          )}

          {basicFallback ? (
            <div className="rounded-[1.4rem] border border-black/10 bg-black/[0.025] p-4 text-sm leading-6 text-black/62">
              Basic Auth fallback is enabled as a temporary safety net. Once Google login is verified, it can be turned off.
            </div>
          ) : null}
        </div>

        <div className="mt-8 border-t border-black/10 pt-6 text-sm text-black/55">
          <p>
            Main routes: <Link href={getAdminLoginPath()} className="underline underline-offset-4">/admin/login</Link>,{' '}
            <Link href="/admin" className="underline underline-offset-4">/admin</Link>, and{' '}
            <Link href="/admin/seo-llm" className="underline underline-offset-4">/admin/seo-llm</Link>.
          </p>
        </div>
      </div>
    </main>
  )
}
