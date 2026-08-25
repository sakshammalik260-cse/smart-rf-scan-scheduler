import type { ReactNode } from 'react'

type PanelProps = { children: ReactNode; className?: string }

export function Panel({ children, className = '' }: PanelProps) {
  return <section className={`surface-panel ${className}`}>{children}</section>
}
