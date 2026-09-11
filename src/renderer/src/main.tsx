import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'
import { useTheme } from './stores/theme'
import './styles/globals.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from index.html')

// Paint the theme before the first render rather than in an effect: the main
// process already knows it, and applying it afterwards shows a frame of the
// wrong one on every launch.
await useTheme.getState().load()

createRoot(container).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <App />
    </TooltipProvider>
  </StrictMode>
)
