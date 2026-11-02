'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { getApiBaseUrl } from './billing'

/** Signed-in call to the Agent Verify API. Throws with the server's own error message. */
export async function apiCall<T>(user: User, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data
}

export interface TeamInfo {
  role: 'owner' | 'member' | 'none'
  seats?: number
  seatsUsed?: number
  members?: Array<{ uid: string; email: string; addedAt: number; active: boolean }>
}

export function useTeam(user: User | null) {
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    if (!user) return
    try {
      setTeam(await apiCall<TeamInfo>(user, '/v1/team'))
      setError(null)
    } catch (e) {
      setTeam({ role: 'none' })
      setError(e instanceof Error ? e.message : 'Could not load your team')
    }
  }, [user])
  useEffect(() => { void reload() }, [reload])
  return { team, error, reload }
}

export interface PlanAvailability {
  teamCheckout: boolean
  /** Per-seat price from Stripe, in the smallest currency unit (e.g. cents). */
  teamSeatPrice?: { unitAmount: number; currency: string; interval: string } | null
  teamMinSeats: number
  teamMaxSeats: number
}

/** Public: whether self-serve Team checkout is switched on yet (it needs a Stripe Team price). */
export async function fetchPlanAvailability(): Promise<PlanAvailability> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/v1/billing/plans`)
    if (!res.ok) throw new Error()
    return (await res.json()) as PlanAvailability
  } catch {
    return { teamCheckout: false, teamSeatPrice: null, teamMinSeats: 2, teamMaxSeats: 100 }
  }
}

export interface GithubConfig { configured: boolean; installUrl: string; clientId?: string | null; scansPerMonth: { unlinked: number; free: number; pro: number } }

export interface RepoScan {
  repo_full_name: string
  branch: string
  trigger: 'push' | 'pull_request' | 'manual'
  pr_number: number | null
  commit_sha: string
  score: number
  verdict: string
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  created_at: number
}

export interface GithubInstallations {
  installations: Array<{ installation_id: number; account_login: string; account_type: string; suspended: number; scansThisMonth: number }>
  repos: Array<{ repo: string; latest: RepoScan; history: Array<{ score: number; at: number; sha: string }>; recentPrs: RepoScan[] }>
}

export interface AlertSettings { slackWebhookUrl: string; email: string; minSeverity: 'critical' | 'high' | 'medium'; emailAvailable: boolean }
