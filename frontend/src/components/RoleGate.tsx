import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import type { Role } from '../lib/types'

export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth()
  if (!hasRole(...roles)) return null
  return <>{children}</>
}
