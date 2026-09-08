import { Component } from 'react'
import type { ReactNode } from 'react'

export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <div className="scene-unavailable" role="status">3D view unavailable</div>
      : this.props.children
  }
}
