import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Names the pane in the message, so the user knows what failed. */
  label: string
}

interface State {
  error: Error | null
}

/**
 * Stops one pane's render error from taking the window with it.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which in a desktop app reads as the program vanishing — no message, no
 * window content, nothing to report. A boundary per pane keeps the rest of
 * the app usable and puts the error somewhere it can be read.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console so a report can carry a stack, since nothing here
    // is sent anywhere.
    console.error(`${this.props.label} failed to render`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-default p-4 text-center">
        <p className="text-xs text-danger-content">{this.props.label} could not be shown</p>
        <p className="selectable max-w-md truncate text-2xs text-content-tertiary">
          {error.message}
        </p>
        <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    )
  }
}
