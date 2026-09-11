import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/stores/theme'
import type { ThemeSetting } from '@shared/ipc'

const OPTIONS: { value: ThemeSetting; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match the system', icon: Monitor }
]

/**
 * Three states shown at once rather than a cycling button: the difference
 * between "dark" and "matching a system that happens to be dark" is invisible
 * until the OS changes, and a single toggle can never show which one is on.
 */
export function ThemeToggle(): React.JSX.Element {
  const setting = useTheme((s) => s.setting)
  const set = useTheme((s) => s.set)

  return (
    <div
      className="flex shrink-0 items-center gap-px rounded-sm p-px"
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={setting === value}
          title={label}
          onClick={() => void set(value)}
          className={cn(
            'flex size-4 items-center justify-center rounded-xs transition-colors',
            setting === value
              ? 'bg-surface-active text-content-primary'
              : 'text-content-tertiary hover:text-content-secondary'
          )}
        >
          <Icon className="size-3" />
        </button>
      ))}
    </div>
  )
}
