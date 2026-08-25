const steps = ['Upload Scenario', 'Validate', 'Start Smart V3', 'Observe Decisions', 'Compare Schedulers']

export function WorkflowSteps() {
  return (
    <section className="mb-6 surface-panel px-4 py-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Demo workflow</p>
          <p className="mt-1 text-xs text-[#89878a]">A clean path from TSRD input to live scheduler comparison.</p>
        </div>
        <span className="muted-label">Current stage: 01 Upload</span>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => (
          <div className="flex items-center gap-2" key={step}>
            <div className={`surface-card flex min-h-12 flex-1 items-center gap-3 px-3 py-3 ${index === 0 ? 'border-[#d94a4a] bg-[#2a1b1f]' : ''}`}>
              <span className={`font-mono text-[10px] ${index === 0 ? 'text-[#d94a4a]' : 'text-[#89878a]'}`}>0{index + 1}</span>
              <span className="text-xs text-[#c0bdb7]">{step}</span>
            </div>
            {index < steps.length - 1 && <span className="hidden text-[#514044] md:block">→</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
