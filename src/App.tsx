import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import WebRTCPage from './pages/WebRTCPage';
import ChatPage from './pages/ChatPage';
import FCMNotificationPage from './pages/FCMNotificationPage';
import DoodlePage from './pages/DoodlePage';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

function App() {
  const [count, setCount] = useState(0);

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
        <nav className="main-navigation" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <ul style={{ listStyleType: 'none', padding: 0, margin: 0, display: 'flex', gap: '1rem' }}>
            <li>
              <Link to="/video" style={{ textDecoration: 'none', color: 'blue', fontWeight: 'bold' }}>
                🏠 Video Conference
              </Link>
            </li>
            <li>
              <Link to="/chat" style={{ textDecoration: 'none', color: 'purple', fontWeight: 'bold' }}>
                💬 Chat
              </Link>
            </li>
            <li>
              <Link to="/notifications" style={{ textDecoration: 'none', color: 'green', fontWeight: 'bold' }}>
                🔔 FCM Notifications
              </Link>
            </li>
            <li>
              <Link to="/doodle" style={{ textDecoration: 'none', color: 'orange', fontWeight: 'bold' }}>
                🎨 Doodle
              </Link>
            </li>
          </ul>
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
          <Route path="/video" element={<WebRTCPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/notifications" element={<FCMNotificationPage />} />
          <Route path="/doodle" element={<DoodlePage />} />
          <Route path="/" element={<WebRTCPage />} />
        </Routes>
      </>
    </Router>
  );
}

export default App;