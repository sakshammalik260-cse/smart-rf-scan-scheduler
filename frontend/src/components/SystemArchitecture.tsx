const steps = ['RF Environment', 'Receiver', 'Feature Generator', 'Random Forest', 'V3 Scheduler', 'Next Band']

export function SystemArchitecture() {
  return (
    <section className="border border-[#29423f] bg-[#0b191c]">
      <div className="flex flex-col gap-2 border-b border-[#29423f] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#67e8c5]">Pipeline / 01</p>
          <h2 className="mt-2 font-display text-xl font-medium text-[#e7f4f1]">System Architecture</h2>
        </div>
        <p className="font-mono text-[10px] text-[#668681]">Inference loop · nominal</p>
      </div>
      <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-6 lg:items-center lg:gap-0">
        {steps.map((step, index) => (
          <div className="flex items-center gap-2 lg:block" key={step}>
            <div className="flex min-h-16 flex-1 items-center border border-[#31504a] bg-[#102326] px-3 py-3 sm:min-h-[72px] sm:px-4 lg:justify-center lg:text-center">
              <span className="font-mono text-xs leading-relaxed text-[#b4d0c9]">{step}</span>
            </div>
            {index < steps.length - 1 && <span className="px-1 font-mono text-lg text-[#67e8c5] lg:block lg:py-3 lg:text-center">→</span>}
          </div>
        ))}
      </div>
    </section>
  )
}