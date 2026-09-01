/**
 * Role-Based Access Control — the authoritative permission matrix for Organizations.
 *
 * This is the ONLY place that decides what a role can do. It is enforced here, in the Worker
 * API, against data read via the Firebase service-account token (which bypasses firestore.rules
 * entirely — see firebaseAuth.ts) — so this module, not a UI element and not a rules file alone,
 * is what actually stops a MEMBER from doing something only an OWNER should be able to do.
 * apps/web/src/lib/rbac.ts holds a UI-only mirror of this same matrix for button visibility; it
 * is explicitly documented there as non-authoritative, and enforcement never relies on it.
 */

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export type Permission =
  | 'view_agent'
  | 'start_scan'
  | 'view_report'
  | 'share_report'
  | 'revoke_share'
  | 'view_api_keys'
  | 'create_api_key'
  | 'rotate_api_key'
  | 'view_policies'
  | 'modify_policies'
  | 'view_members'
  | 'invite_members'
  | 'modify_roles'
  | 'view_audit_log'
  | 'configure_integrations'
  | 'configure_webhook'
  | 'billing_access'
  | 'delete_organization'

/**
 * The full permission matrix, spelled out explicitly (never "OWNER gets everything by default,
 * everyone else opts in" or vice versa) so every cell is a deliberate decision, reviewable in one
 * place. See docs/rbac-matrix.md for the plain-English table this mirrors.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    'view_agent', 'start_scan', 'view_report', 'share_report', 'revoke_share',
    'view_api_keys', 'create_api_key', 'rotate_api_key',
    'view_policies', 'modify_policies',
    'view_members', 'invite_members', 'modify_roles',
    'view_audit_log',
    'configure_integrations', 'configure_webhook',
    'billing_access', 'delete_organization',
  ],
  ADMIN: [
    'view_agent', 'start_scan', 'view_report', 'share_report', 'revoke_share',
    'view_api_keys', 'create_api_key', 'rotate_api_key',
    'view_policies', 'modify_policies',
    'view_members', 'invite_members',
    // NOT modify_roles — an ADMIN promoting themselves (or anyone) to OWNER would be a real
    // privilege-escalation bug, so role changes are OWNER-only, deliberately excluded here.
    'view_audit_log',
    'configure_integrations', 'configure_webhook',
    // NOT billing_access, NOT delete_organization — irreversible/financial actions stay OWNER-only.
  ],
  MEMBER: [
    'view_agent', 'start_scan', 'view_report', 'share_report', 'revoke_share',
    'view_api_keys', 'create_api_key', 'rotate_api_key',
    'view_policies',
    'view_members',
    'view_audit_log',
    // NOT modify_policies, NOT invite_members, NOT modify_roles, NOT configure_integrations/webhook,
    // NOT billing_access, NOT delete_organization — a MEMBER operates agents/scans/reports day to
    // day but does not change organization-wide configuration or membership.
  ],
  VIEWER: [
    'view_agent', 'view_report', 'view_policies', 'view_members', 'view_audit_log',
    // Read-only. No scan, no share, no key management, no configuration, nothing that mutates.
  ],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function isValidRole(value: unknown): value is Role {
  return value === 'OWNER' || value === 'ADMIN' || value === 'MEMBER' || value === 'VIEWER'
}
