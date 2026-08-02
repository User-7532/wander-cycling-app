import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        {/* reducedMotion="user" makes every framer-motion animation in the app
            respect the OS "reduce motion" accessibility setting automatically */}
        <MotionConfig reducedMotion="user">
          <App />
          <Toaster richColors position="top-center" />
        </MotionConfig>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
