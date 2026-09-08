import { HOLDOUT_LABEL, modelResults } from '../data/mockData'
import { api } from '../services/api'
import { useEffect, useState } from 'react'
import type { ModelComparisonResult } from '../types/api'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'

const notes: Record<string, string> = {
  Sequential: 'Broad scanning, but many wasted scans.',
  'Adaptive V1': 'Aggressive hit seeking with reduced coverage.',
  'RF V2': 'Very high hit rate, but over-exploitation risk.',
  'Smart V3': 'Strong interception with highest coverage and lowest delay.',
}

function Bar({ label, value, max = 100, lowerIsBetter = false, unit = '%' }: { label: string; value: number; max?: number; lowerIsBetter?: boolean; unit?: string }) {
  const width = lowerIsBetter ? Math.max(4, ((max - value) / max) * 100) : Math.max(4, (value / max) * 100)
  return <div><div className="mb-2 flex justify-between text-xs"><span className="text-[#89878a]">{label}</span><span className="font-mono text-[#e6e1da]">{unit === 's' ? `${value.toFixed(3)} s` : `${value.toFixed(2)}%`}</span></div><div className="h-2 bg-[#202126]"><div className="h-full bg-[#d94a4a]" style={{ width: `${width}%` }} /></div></div>
}

export function ModelComparisonPage() {
  const [results, setResults] = useState<ModelComparisonResult[]>(modelResults.map((result) => ({ model: result.shortName as ModelComparisonResult['model'], metrics: { hitRate: result.hitRate, missRate: 100 - result.hitRate, emitterCoverage: result.coverage, averageInterceptionDelaySeconds: result.delay, scanEntropy: result.entropy } })))
  useEffect(() => { void api.getModelComparison().then(setResults) }, [])

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow="Model Comparison / Final benchmark" title="Performance trade-offs" detail="The final holdout benchmark shows different operational personalities. Smart V3 is not universal-best; it is the balanced coverage-and-delay scheduler." />
      <p className="surface-card w-fit px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#c0bdb7]">{HOLDOUT_LABEL}</p>

      <div className="grid gap-5 xl:grid-cols-4">
        {results.map((result) => {
          const smart = result.model === 'Smart V3'
          return (
            <Panel className={`model-tower p-5 ${smart ? 'model-tower-active border-[#d94a4a] bg-[#2a1b1f]' : ''}`} key={result.model}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="muted-label">Strategy</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">{result.model}</h3></div>
                {smart && <span className="bg-[#d94a4a] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white">Candidate 17</span>}
              </div>
              <p className="mt-4 min-h-10 text-sm leading-relaxed text-[#89878a]">{notes[result.model]}</p>
              <div className="mt-6 space-y-4">
                <Bar label="Hit rate" value={result.metrics.hitRate} />
                <Bar label="Coverage" value={result.metrics.emitterCoverage} />
                <Bar label="Delay" value={result.metrics.averageInterceptionDelaySeconds} max={1} lowerIsBetter unit="s" />
              </div>
            </Panel>
          )
        })}
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[720px] text-left text-xs">
            <thead><tr>{['Strategy', 'Hit Rate', 'Emitter Coverage', 'Avg Delay', 'Miss Rate', 'Interpretation'].map((heading) => <th className="px-5 py-4" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>
              {results.map((result) => <tr className={result.model === 'Smart V3' ? 'bg-[#2a1b1f]' : ''} key={result.model}><td className="px-5 py-4 font-medium text-[#e6e1da]">{result.model}</td><td className="px-5 py-4 font-mono text-[#c0bdb7]">{result.metrics.hitRate.toFixed(2)}%</td><td className="px-5 py-4 font-mono text-[#c0bdb7]">{result.metrics.emitterCoverage.toFixed(2)}%</td><td className="px-5 py-4 font-mono text-[#c0bdb7]">{result.metrics.averageInterceptionDelaySeconds.toFixed(3)} s</td><td className="px-5 py-4 font-mono text-[#89878a]">{result.metrics.missRate.toFixed(2)}%</td><td className="px-5 py-4 text-[#89878a]">{notes[result.model]}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
