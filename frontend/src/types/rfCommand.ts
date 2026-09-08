export type CommandTargetKind = 'core' | 'band' | 'device' | 'pipeline'

export type CommandTarget = {
  id: string
  kind: CommandTargetKind
  label: string
  status: string
  summary: string
  metadata: Array<{ label: string; value: string }>
}
