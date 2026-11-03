import type { D1Database } from './billing'

/** Signup "About you" details. All optional; nothing here is needed to use the product. */
export const ROLES = ['engineer', 'security', 'manager', 'founder', 'compliance', 'student', 'other'] as const
export const TEAM_SIZES = ['1', '2-10', '11-50', '51-200', '200+'] as const
export const FRAMEWORKS = ['langchain', 'openai-agents', 'mcp', 'crewai', 'anthropic', 'llamaindex', 'custom'] as const
export const HEARD_FROM = ['google', 'github', 'friend', 'reddit-hn', 'x-linkedin', 'product-hunt', 'other'] as const

const nowSec = () => Math.floor(Date.now() / 1000)
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return t || null
}
const pick = <T extends readonly string[]>(v: unknown, allowed: T): T[number] | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T[number] : null)

/** Records that this account exists / was just seen. Cheap, and never throws. */
export async function touchUserProfile(db: D1Database | undefined, uid: string, email?: string, now = nowSec(), emailVerified = false): Promise<void> {
  if (!db) return
  try {
    await db.prepare(`INSERT INTO user_profiles (uid, email, email_verified, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET last_seen_at = excluded.last_seen_at, email = COALESCE(excluded.email, user_profiles.email),
        email_verified = MAX(user_profiles.email_verified, excluded.email_verified)`)
      .bind(uid, email ?? null, emailVerified ? 1 : 0, now, now).run()
  } catch {
    // admin.sql not applied yet
  }
}

export interface ProfileView {
  name: string | null
  company: string | null
  role: string | null
  teamSize: string | null
  building: string[]
  heardFrom: string | null
  onboarded: boolean
}

export async function getUserProfile(db: D1Database, uid: string): Promise<ProfileView> {
  const row = await db.prepare('SELECT name, company, role, team_size, building, heard_from, onboarded_at FROM user_profiles WHERE uid = ?').bind(uid)
    .first<{ name: string | null; company: string | null; role: string | null; team_size: string | null; building: string | null; heard_from: string | null; onboarded_at: number | null }>()
  let building: string[] = []
  try { building = row?.building ? JSON.parse(row.building) : [] } catch { building = [] }
  return {
    name: row?.name ?? null, company: row?.company ?? null, role: row?.role ?? null, teamSize: row?.team_size ?? null,
    building, heardFrom: row?.heard_from ?? null, onboarded: Boolean(row?.onboarded_at),
  }
}

/** POST /v1/profile — saves the About you step (or marks it skipped with { skip: true }). */
export async function saveUserProfile(db: D1Database, uid: string, email: string | undefined, body: Record<string, unknown>, now = nowSec()): Promise<{ status: number; body: unknown }> {
  await touchUserProfile(db, uid, email, now)
  if (body.skip === true) {
    await db.prepare('UPDATE user_profiles SET onboarded_at = COALESCE(onboarded_at, ?) WHERE uid = ?').bind(now, uid).run()
    return { status: 200, body: { ok: true } }
  }
  const building = Array.isArray(body.building) ? [...new Set(body.building.filter(b => (FRAMEWORKS as readonly unknown[]).includes(b)))] : []
  await db.prepare(`UPDATE user_profiles SET name = ?, company = ?, role = ?, team_size = ?, building = ?, heard_from = ?, onboarded_at = ? WHERE uid = ?`)
    .bind(clean(body.name, 80), clean(body.company, 120), pick(body.role, ROLES), pick(body.teamSize, TEAM_SIZES), JSON.stringify(building), pick(body.heardFrom, HEARD_FROM), now, uid).run()
  return { status: 200, body: { ok: true, profile: await getUserProfile(db, uid) } }
}
