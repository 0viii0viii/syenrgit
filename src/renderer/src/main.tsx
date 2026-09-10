import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'
import './styles/globals.css'

// Theme is applied before first paint elsewhere in a real build; for now the
// app is dark-first and the class is the single switch the token layers read.
document.documentElement.classList.add('dark')

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from index.html')

createRoot(container).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <App />
    </TooltipProvider>
  </StrictMode>
)
