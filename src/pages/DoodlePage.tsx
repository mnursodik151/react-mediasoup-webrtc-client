import { useEffect, useState, useRef } from 'react';
import './WebRTCPage.css';
import './DoodlePage.css';
import DoodleSpace from '../components/DoodleSpace';
import ConfigurationModal from '../components/Meeting/ConfigurationModal';
import { useSocket } from '../hooks/useSocket';
import { useWebRTCDataChannel } from '../hooks/useWebRTCDataChannel';

export default function DoodlePage() {
  const {
    socket,
    userId,
    wsIP,
    showConfigModal,
    setWsIP,
    setUserId,
    setShowConfigModal,
    handleConfigSubmit
  } = useSocket();

  const {
    isConnected,
    joinRoom,
    leaveRoom,
    sendData,
    receivedData
  } = useWebRTCDataChannel(socket);

  const [roomId] = useState('doodle-room');
  const [doodleEvents, setDoodleEvents] = useState<any[]>([]);
  const mountedRef = useRef(false);

  // Auto-join room when socket is available
  useEffect(() => {
    if (socket && userId && !mountedRef.current) {
      console.log('Auto-joining doodle room:', roomId);
      console.log('Socket state:', { 
        connected: socket.connected, 
        id: socket.id 
      });
      console.log('User ID:', userId);
      
      joinRoom(roomId, userId);
      mountedRef.current = true;
    }

    return () => {
      if (isConnected) {
        console.log('Leaving doodle room');
        leaveRoom();
      }
    };
  }, [socket, userId, roomId, joinRoom, leaveRoom, isConnected]);

  // Process received data with timestamp tracking to help debugging
  const lastProcessedTimestampRef = useRef(0);
  
  useEffect(() => {
    if (receivedData.length > 0) {
      const now = Date.now();
      console.log(`Received ${receivedData.length} doodle events at ${now}:`, receivedData);
      
      // Add timestamp to events if missing
      const eventsWithTimestamps = receivedData.map(event => ({
        ...event,
        timestamp: event.timestamp || now,
        source: 'remote'
      }));
      
      // Log time since last processed batch
      if (lastProcessedTimestampRef.current > 0) {
        const timeSinceLastBatch = now - lastProcessedTimestampRef.current;
        console.log(`Time since last batch: ${timeSinceLastBatch}ms`);
      }
      lastProcessedTimestampRef.current = now;
      
      setDoodleEvents(prev => [...prev, ...eventsWithTimestamps]);
    }
  }, [receivedData]);

  // Handle doodle event broadcasting
  const handleBroadcastDoodle = (event: any) => {
    // Add timestamp to track event flow
    const eventWithTimestamp = {
      ...event,
      timestamp: Date.now(),
      source: 'local'
    };
    console.log('Broadcasting doodle event:', eventWithTimestamp);
    
    // Always add to local events for consistent rendering
    setDoodleEvents(prev => [...prev, eventWithTimestamp]);
    
    // Try to send to other peers and check result
    if (isConnected) {
      console.log('Connection status before sending:', isConnected ? 'connected' : 'disconnected');
      const sent = sendData(eventWithTimestamp);
      if (!sent) {
        console.warn('Failed to send doodle event - data channel may have closed');
        // We might show a visual indicator that the connection was lost
      }
    } else {
      console.warn('Not sending doodle event - data channel not connected');
      sendData(eventWithTimestamp);
    }
  };

  // Debug rendering cycles and connection state changes
  useEffect(() => {
    console.log('DoodlePage rendered - doodleEvents count:', doodleEvents.length);
    return () => {
      console.log('DoodlePage cleanup');
    };
  });
  
  // Log connection state changes
  useEffect(() => {
    console.log('Connection status changed to:', isConnected ? 'connected' : 'disconnected');
  }, [isConnected]);

  return (
    <div className="meeting-container">
      {showConfigModal && (
        <ConfigurationModal
          wsIP={wsIP}
          setWsIP={setWsIP}
          userId={userId}
          setUserId={setUserId}
          onSubmit={handleConfigSubmit}
          hasActiveConnection={!!socket}
        />
      )}
      <h1>Collaborative Doodling</h1>
      <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        Status: {isConnected ? 'Connected' : 'Disconnected'}
      </div>
      {!isConnected && (
        <div className="disconnected-warning">
          You are currently disconnected. You can still draw locally, but your drawings won't be shared with others.
        </div>
      )}
      <div>Room ID: {roomId}</div>
      
      <div className="main-content">
        <DoodleSpace
          broadcastDoodleEvent={handleBroadcastDoodle}
          doodleEvents={doodleEvents}
        />
      </div>
    </div>
  );
}
