import './ag/setup.ts' // must stay first: publishes the design tokens and registers AG modules before any component module loads
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './product/product.css'
import ProductApp from './product/ProductApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductApp />
  </StrictMode>,
)
