import { ArrowDown, ArrowRight } from 'lucide-react'
import { api } from '../services/api'
import { bandScores } from '../services/simulationApi'
import { useEffect, useState } from 'react'
import type { BandScore } from '../types/api'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'

const flow = ['Receiver Observations', '30 Historical Features', 'Random Forest', '36 Activity Probabilities', 'Smart V3 Candidate 17', 'Next Frequency Band']

export function SchedulerPage() {
  const [bands, setBands] = useState<BandScore[]>(bandScores)
  useEffect(() => { void api.getBandScores().then(setBands) }, [])
  const ranked = [...bands].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 8)
  const maxScore = Math.max(...ranked.map((band) => band.priorityScore), 1)

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
          <p className="section-kicker">Candidate ranking</p>
          <h3 className="mt-2 font-display text-xl text-[#e6e1da]">Top scheduling priorities</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[760px] text-left text-xs">
            <thead><tr>{['Rank', 'Band', 'Frequency Range', 'RF Probability', 'Exploration', 'Time Since Visit', 'V3 Priority'].map((heading) => <th className="px-5 py-4" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>
              {ranked.map((band, index) => (
                <tr className={index === 0 ? 'bg-[#2a1b1f]' : 'hover:bg-[#15171b]'} key={band.band}>
                  <td className="px-5 py-4 font-mono text-[#d94a4a]">#{index + 1}</td>
                  <td className="px-5 py-4 font-mono text-[#e6e1da]">Band {band.band}</td>
                  <td className="px-5 py-4 text-[#c0bdb7]">{band.frequencyStartGHz.toFixed(1)}-{band.frequencyEndGHz.toFixed(1)} GHz</td>
                  <td className="px-5 py-4 font-mono text-[#c0bdb7]">{Math.round(band.rfProbability * 100)}%</td>
                  <td className="px-5 py-4 font-mono text-[#c0bdb7]">{band.explorationScore.toFixed(2)}</td>
                  <td className="px-5 py-4 font-mono text-[#89878a]">{band.timeSinceVisitSeconds}s</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3"><div className="h-2 w-28 bg-[#202126]"><div className="h-full bg-[#d94a4a]" style={{ width: `${(band.priorityScore / maxScore) * 100}%` }} /></div><span className="font-mono text-[#e6e1da]">{band.priorityScore.toFixed(2)}</span></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
        {['Predict', 'Explore', 'Prioritize', 'Intercept'].map((step, index) => <div className="flex items-center gap-3" key={step}><span className="flow-chip surface-card px-4 py-3 text-sm text-[#e6e1da]">{step}</span>{index < 3 && <ArrowRight size={15} className="text-[#514044]" />}</div>)}
        </div>
      </Panel>
    </div>
  )
}
