import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import WebRTCPage from './pages/WebRTCPage';

function App() {
  const [count, setCount] = useState(0)

  return (
    <Router>
      <>
        <div>
          <a href="https://vite.dev" target="_blank">
            <img src={viteLogo} className="logo" alt="Vite logo" />
          </a>
          <a href="https://react.dev" target="_blank">
            <img src={reactLogo} className="logo react" alt="React logo" />
          </a>
        </div>
        <h1>Vite + React</h1>
        <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <Link to="/" style={{ textDecoration: 'none', color: 'blue', fontWeight: 'bold' }}>
            🏠 Home
          </Link>
          <Link to="/webrtc" style={{ textDecoration: 'none', color: 'purple', fontWeight: 'bold' }}>
            📹 WebRTC Page
          </Link>
        </nav>
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            count is {count}
          </button>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR?
          </p>
        </div>
        <p className="read-the-docs">
          Click on the Vite and React logos to learn more
        </p>
        <Routes>
          <Route path="/webrtc" element={<WebRTCPage />} />
        </Routes>
      </>
    </Router>
  )
}

export default App