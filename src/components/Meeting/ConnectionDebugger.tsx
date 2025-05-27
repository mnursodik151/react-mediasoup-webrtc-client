import React from 'react';

interface ConnectionDebuggerProps {
  socketConnected: boolean;
  mediasoupLoaded: boolean;
  remotePeers: Array<{peerId: string; stream: MediaStream}>;
  roomId: string;
  peerId: string;
}

const ConnectionDebugger: React.FC<ConnectionDebuggerProps> = ({
  socketConnected,
  mediasoupLoaded,
  remotePeers,
  roomId,
  peerId
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
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default ConnectionDebugger;
