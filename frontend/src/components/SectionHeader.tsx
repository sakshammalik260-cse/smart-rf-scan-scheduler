type SectionHeaderProps = { eyebrow: string; title: string; detail?: string }

export function SectionHeader({ eyebrow, title, detail }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="section-kicker">{eyebrow}</p>
      <h2 className="font-display text-2xl font-semibold tracking-tight text-[#e6e1da]">{title}</h2>
      {detail && <p className="max-w-3xl text-sm leading-relaxed text-[#89878a]">{detail}</p>}
    </div>
  )
}
