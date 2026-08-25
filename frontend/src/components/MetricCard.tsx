type MetricCardProps = {
  label: string
  value: string
  detail: string
  accent: string
}

export function MetricCard({ label, value, detail, accent }: MetricCardProps) {
  return (
    <article className="metric-soft group relative overflow-hidden p-4 sm:p-5">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${accent}`} />
      <p className="muted-label">{label}</p>
      <p className="mt-4 font-display text-3xl font-semibold tracking-tight text-[#e6e1da] sm:text-[2rem]">{value}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-[#89878a]">{detail}</p>
    </article>
  )
}
