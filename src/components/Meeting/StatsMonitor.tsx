import React, { useState, useEffect } from 'react';
import './StatsMonitor.css';

interface ConnectionStats {
  connectionState: string;
  candidates: {
    host: number;
    srflx: number;
    relay: number;
  };
  dataFlow: {
    sendBitrate: number;
    receiveBitrate: number;
    totalBytesSent: number;
    totalBytesReceived: number;
    timestamp: number;
  };
  tracks: {
    sending: {
      kind: string;
      enabled: boolean;
      muted: boolean;
    }[];
    receiving: {
      kind: string;
      enabled: boolean;
      muted: boolean;
    }[];
  };
}

interface StatsMonitorProps {
  stats: Record<string, ConnectionStats>;
  expanded?: boolean;
}

const StatsMonitor: React.FC<StatsMonitorProps> = ({ stats, expanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(expanded);
  
  return (
    <div className={`stats-monitor ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="stats-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h3>WebRTC Connection Stats</h3>
        <span>{isExpanded ? '▼' : '▲'}</span>
      </div>
      
      {isExpanded && (
        <div className="stats-content">
          {Object.entries(stats).map(([connectionId, connectionStats]) => (
            <div key={connectionId} className="connection-stats">
              <h4>{connectionId}</h4>
              <div className="stat-row">
                <span className="stat-label">Connection State:</span>
                <span className={`stat-value state-${connectionStats.connectionState}`}>
                  {connectionStats.connectionState}
                </span>
              </div>
              
              <div className="stat-row">
                <span className="stat-label">ICE Candidates:</span>
                <span className="stat-value">
                  Host: {connectionStats.candidates.host}, 
                  SRFLX: {connectionStats.candidates.srflx}, 
                  Relay: {connectionStats.candidates.relay}
                </span>
              </div>
              
              <div className="stat-row">
                <span className="stat-label">Data Flow:</span>
                <span className="stat-value">
                  Send: {connectionStats.dataFlow.sendBitrate.toFixed(2)} kbps, 
                  Receive: {connectionStats.dataFlow.receiveBitrate.toFixed(2)} kbps
                </span>
              </div>
              
              <div className="stat-row">
                <span className="stat-label">Total Data:</span>
                <span className="stat-value">
                  Sent: {(connectionStats.dataFlow.totalBytesSent/1024).toFixed(2)} KB, 
                  Received: {(connectionStats.dataFlow.totalBytesReceived/1024).toFixed(2)} KB
                </span>
              </div>
              
              <div className="tracks-container">
                <h5>Tracks</h5>
                <div className="tracks-grid">
                  <div className="track-column">
                    <h6>Sending ({connectionStats.tracks.sending.length})</h6>
                    {connectionStats.tracks.sending.map((track, i) => (
                      <div key={`sending-${i}`} className="track-item">
                        {track.kind} - {track.enabled ? 'Enabled' : 'Disabled'} {track.muted ? '(Muted)' : ''}
                      </div>
                    ))}
                  </div>
                  <div className="track-column">
                    <h6>Receiving ({connectionStats.tracks.receiving.length})</h6>
                    {connectionStats.tracks.receiving.map((track, i) => (
                      <div key={`receiving-${i}`} className="track-item">
                        {track.kind} - {track.enabled ? 'Enabled' : 'Disabled'} {track.muted ? '(Muted)' : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StatsMonitor;