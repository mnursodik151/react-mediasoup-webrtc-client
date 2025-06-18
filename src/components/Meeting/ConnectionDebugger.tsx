import React from 'react';

interface ConnectionDebuggerProps {
  socketConnected: boolean;
  mediasoupLoaded: boolean;
  remotePeers: Array<{peerId: string; stream: MediaStream}>;
  roomId: string;
  peerId: string;
  debugInfo?: {
    iceParameters?: any;
    dtlsParameters?: any;
    localResolution?: {
      width: number;
      height: number;
      frameRate: number;
      codec: string;
    };
    remoteResolutions?: Record<string, {
      width: number;
      height: number;
      frameRate: number;
      codec: string;
      trackId: string;
    }>;
  };
}

const ConnectionDebugger: React.FC<ConnectionDebuggerProps> = ({
  socketConnected,
  mediasoupLoaded,
  remotePeers,
  roomId,
  peerId,
  debugInfo = {}
}) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="connection-debugger" style={{
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      color: 'white',
      padding: '10px',
      borderRadius: '5px',
      fontSize: '12px',
      zIndex: 1000,
      maxWidth: expanded ? '400px' : '150px',
      maxHeight: expanded ? '300px' : '30px',
      overflow: 'auto'
    }}>
      {!expanded ? (
        <button 
          onClick={() => setExpanded(true)}
          style={{background: 'none', border: 'none', color: 'white', padding: 0, cursor: 'pointer'}}
        >
          Show Debug Info
        </button>
      ) : (
        <>
          <button 
            onClick={() => setExpanded(false)}
            style={{
              background: 'none', 
              border: 'none', 
              color: 'white', 
              padding: 0, 
              cursor: 'pointer',
              display: 'block',
              marginBottom: '10px'
            }}
          >
            Hide Debug Info
          </button>
          <div>
            <p><strong>Socket:</strong> {socketConnected ? '✅ Connected' : '❌ Disconnected'}</p>
            <p><strong>Mediasoup Device:</strong> {mediasoupLoaded ? '✅ Loaded' : '❌ Not Loaded'}</p>
            <p><strong>Room ID:</strong> {roomId || 'Not in room'}</p>
            <p><strong>Peer ID:</strong> {peerId || 'Not assigned'}</p>
            <p><strong>Remote Peers ({remotePeers.length}):</strong></p>
            <ul style={{paddingLeft: '20px', margin: '5px 0'}}>
              {remotePeers.map(peer => (
                <li key={peer.peerId}>
                  ID: {peer.peerId.substring(0, 8)}... 
                  (Tracks: {peer.stream.getTracks().length})
                  <ul style={{paddingLeft: '20px', margin: '5px 0'}}>
                    {peer.stream.getTracks().map(track => (
                      <li key={track.id}>
                        {track.kind} - {track.label} 
                        {track.readyState === 'live' ? '✅' : '❌'}
                        {track.enabled ? ' (Enabled)' : ' (Disabled)'}
                        {track.muted ? ' (Muted)' : ' (Unmuted)'}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            
            {/* Add WebRTC Debug Information */}
            {debugInfo && (
              <>
                <hr style={{border: '0.5px solid rgba(255,255,255,0.2)', margin: '10px 0'}} />
                <h4 style={{margin: '5px 0', color: '#4CAF50'}}>WebRTC Debug Info</h4>
                
                {/* Local Resolution */}
                {debugInfo.localResolution && (
                  <div>
                    <p><strong>Local Resolution:</strong></p>
                    <div style={{marginLeft: '10px', fontSize: '11px'}}>
                      <p>
                        {debugInfo.localResolution.width}x{debugInfo.localResolution.height} 
                        @ {debugInfo.localResolution.frameRate}fps 
                        ({debugInfo.localResolution.codec})
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Remote Resolutions */}
                {debugInfo.remoteResolutions && Object.keys(debugInfo.remoteResolutions).length > 0 && (
                  <div>
                    <p><strong>Remote Resolutions:</strong></p>
                    <div style={{marginLeft: '10px', fontSize: '11px'}}>
                      {Object.entries(debugInfo.remoteResolutions).map(([peerId, resolution]) => (
                        <p key={peerId}>
                          Peer {peerId.substring(0, 8)}...: {resolution.width}x{resolution.height} 
                          @ {resolution.frameRate}fps ({resolution.codec})
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Connection Parameters - Collapsible */}
                <details style={{marginTop: '10px'}}>
                  <summary style={{cursor: 'pointer', color: '#FFC107'}}>Connection Parameters</summary>
                  <div style={{marginLeft: '10px', fontSize: '10px', overflowX: 'auto', whiteSpace: 'pre-wrap'}}>
                    <p><strong>ICE Parameters:</strong></p>
                    <pre style={{margin: '3px 0', background: 'rgba(0,0,0,0.3)', padding: '4px'}}>
                      {JSON.stringify(debugInfo.iceParameters, null, 2)}
                    </pre>
                    
                    <p><strong>DTLS Parameters:</strong></p>
                    <pre style={{margin: '3px 0', background: 'rgba(0,0,0,0.3)', padding: '4px'}}>
                      {JSON.stringify(debugInfo.dtlsParameters, null, 2)}
                    </pre>
                  </div>
                </details>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ConnectionDebugger;
