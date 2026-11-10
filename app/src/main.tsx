import './ag/setup.ts' // must stay first: registers AG modules and licence keys before any component module loads
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './transaction.css'
import './allocation.css'
import App from './App.tsx'
import { SettleStudioProvider } from './ag/StudioProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettleStudioProvider>
      <App />
    </SettleStudioProvider>
  </StrictMode>,
)
