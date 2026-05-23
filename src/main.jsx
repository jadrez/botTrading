import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TradingBot from './trading-bot-v3.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TradingBot />
  </StrictMode>,
)
