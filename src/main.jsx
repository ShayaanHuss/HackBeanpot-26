import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// import './index.css'
import App from './App.jsx'
import { MirrorCurveProvider } from './contexts/MirrorCurveContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MirrorCurveProvider>
      <App />
    </MirrorCurveProvider>
  </StrictMode>,
)
