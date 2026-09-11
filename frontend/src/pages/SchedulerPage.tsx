import { ArrowDown, ArrowRight } from 'lucide-react'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'

const flow = ['Receiver Observations', '30 Historical Features', 'Random Forest', '36 Activity Probabilities', 'Smart V3 Candidate 17', 'Next Frequency Band']

export function SchedulerPage() {
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow="Smart Scheduler / Candidate 17" title="How the intelligence works" detail="Smart V3 combines frozen Random Forest activity probabilities with receiver-observable history to choose the next frequency band." />

      <Panel className="p-5 sm:p-7">
        <div className="grid gap-3 lg:grid-cols-6">
          {flow.map((step, index) => (
            <div className="flow-cube surface-card p-4 text-center" key={step}>
              <p className="font-mono text-[10px] text-[#d94a4a]">0{index + 1}</p>
              <p className="mt-3 min-h-10 text-sm text-[#e6e1da]">{step}</p>
              {index < flow.length - 1 && <ArrowDown className="mx-auto mt-3 text-[#514044] lg:hidden" size={15} />}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="p-5 sm:p-7">
          <p className="section-kicker">RF probability</p>
          <h3 className="mt-2 font-display text-xl text-[#e6e1da]">Predicted activity signal</h3>
          <p className="mt-3 text-sm leading-relaxed text-[#89878a]">The frozen Random Forest estimates whether each of the 36 candidate bands is likely to contain activity at the current decision time.</p>
        </Panel>
        <Panel className="p-5 sm:p-7">
          <p className="section-kicker">V3 score</p>
          <h3 className="mt-2 font-display text-xl text-[#e6e1da]">Final scheduling priority</h3>
          <p className="mt-3 text-sm leading-relaxed text-[#89878a]">Candidate 17 combines RF probability with revisit, exploration, and repetition terms to avoid narrow over-exploitation.</p>
        </Panel>
      </div>

      <Panel>
        <div className="border-b border-[#2d2e33] px-5 py-5 sm:px-7">
          <p className="section-kicker">Live candidate ranking</p>
          <h3 className="mt-2 font-display text-xl text-[#e6e1da]">Current-session values only</h3>
        </div>
        <div className="p-5 text-sm leading-relaxed text-[#89878a] sm:p-7">Upload an H5 file and start Smart V3 in the Spectrum Monitor to see RF probabilities, Candidate 17 scores, selected bands, pulse counts, and HIT/MISS outcomes from that session. This explanatory page does not display mock live rankings.</div>
      </Panel>

      <Panel className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
        {['Predict', 'Explore', 'Prioritize', 'Intercept'].map((step, index) => <div className="flex items-center gap-3" key={step}><span className="flow-chip surface-card px-4 py-3 text-sm text-[#e6e1da]">{step}</span>{index < 3 && <ArrowRight size={15} className="text-[#514044]" />}</div>)}
        </div>
      </Panel>
    </div>
  )
}
