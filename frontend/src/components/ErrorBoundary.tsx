import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in render tree:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
            <span
              style={{
                width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center',
                background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)',
              }}
            >
              <i className="ph ph-warning" style={{ fontSize: 20, color: 'var(--c-accent-strong)' }} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <h4 style={{ margin: 0 }}>Something went wrong rendering this page</h4>
              <span style={{ fontSize: 13, color: 'var(--c-text2)' }}>{this.state.error.message}</span>
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => (window.location.href = '/projects')}>
              Back to projects
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
