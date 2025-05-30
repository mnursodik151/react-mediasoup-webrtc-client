import React, { useRef, useState, useEffect } from 'react';
import './WebRTCPage.css';

// Import components
import ConfigurationModal from '../components/Meeting/ConfigurationModal';
import InviteModal from '../components/Meeting/InviteModal';
import InvitationModal from '../components/Meeting/InvitationModal';
import MainVideo from '../components/Meeting/MainVideo';
import ParticipantVideo from '../components/Meeting/ParticipantVideo';
import ControlBar from '../components/Meeting/ControlBar';
import ConnectionDebugger from '../components/Meeting/ConnectionDebugger';
// Add import for the StatsMonitor
import StatsMonitor from '../components/Meeting/StatsMonitor';

// Import hooks
import { useSocket } from '../hooks/useSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';

export default function MediaRoom() {
  // Use custom hooks
  const {
    socket,
    wsIP,
    userId,
    showConfigModal,
    setWsIP,
    setUserId,
    setShowConfigModal,
    handleConfigSubmit,
    incomingInvitation,
    showInvitationModal,
    setShowInvitationModal,
    setIncomingInvitation,
    sendInvites,
    disconnectSocket  // Get the disconnect function
  } = useSocket();

  const {
    localStreamRef,
    isMuted,
    isVideoOff,
    getMediaStream,
    toggleMute,
    toggleVideo,
    cleanupMedia,
    currentResolution,
    setCurrentResolution
    // updateResolution // Commented out for bandwidth optimization
  } = useMediaStream();

  const {
    roomId,
    setRoomId,
    peerId,
    isJoined,
    remotePeers,
    activeVideoId,
    setActiveVideoId,
    joinRoom,
    leaveRoom,
    cleanupRoomResources,
    preferredCodec,
    setPreferredCodec,
    connectionStats // Add this line
  } = useWebRTC(socket);

  // Local state for UI
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [inviteUserIds, setInviteUserIds] = useState<string>('');
  const [invitationStatus, setInvitationStatus] = useState<string>('');
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Add a state for invitation acceptance process
  const [acceptingInvitation, setAcceptingInvitation] = useState<boolean>(false);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  // Handle joining a room
  const handleJoinRoom = async () => {
    if (!socket) {
      alert('Socket connection not established. Please configure connection settings first.');
      setShowConfigModal(true);
      return;
    }

    try {
      console.log('Requesting user media...');
      const stream = await getMediaStream();
      console.log('User media obtained:', stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();
        console.log('Local video stream set.');
      }

      await joinRoom(stream);
    } catch (error) {
      console.error('Error joining room:', error);
    }
  };

  // Handle disconnect/leaving room
  const handleDisconnect = () => {
    leaveRoom();
    cleanupMedia();
  };

  // Handle manual socket disconnection from config modal
  const handleManualDisconnect = () => {
    disconnectSocket();
  };

  // Handle invite submission
  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!inviteUserIds.trim()) {
      setInvitationStatus('Error: Please enter at least one user ID');
      return;
    }

    const userIds = inviteUserIds.split(',').map(id => id.trim()).filter(Boolean);

    if (userIds.length === 0) {
      setInvitationStatus('Error: No valid user IDs provided');
      return;
    }

    console.log(`Sending invitations to: ${userIds.join(', ')}`);
    sendInvites(roomId, peerId, userIds);

    setInvitationStatus(`Invitations sent to ${userIds.length} user(s)`);

    // Clear the input after a successful send
    setTimeout(() => {
      setInviteUserIds('');
      setInvitationStatus('');
      setShowInviteModal(false);
    }, 2000);
  };

  // Simplified invitation acceptance handler that mimics the button join flow
  const handleAcceptInvitation = async () => {
    if (!incomingInvitation || acceptingInvitation) return;

    console.log('Starting invitation acceptance process for room:', incomingInvitation.roomId);
    setAcceptingInvitation(true);
    setInvitationError(null);

    try {
      // Update room ID from the invitation
      const invitedRoomId = incomingInvitation.roomId;
      console.log('Setting room ID to:', invitedRoomId);
      setRoomId(invitedRoomId);

      // Close the invitation modal
      setShowInvitationModal(false);
      setIncomingInvitation(null);

      // Simply call the same join function as the button
      console.log('Using standard join flow with invited room ID');
      await handleJoinRoom();

    } catch (error) {
      console.error('Error joining invited room:', error);
      setInvitationError('Failed to join meeting. Please try again.');
    } finally {
      setAcceptingInvitation(false);
    }
  };

  // Handle declining an invitation
  const handleDeclineInvitation = () => {
    setShowInvitationModal(false);
    setIncomingInvitation(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      leaveRoom();
      cleanupMedia();
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      leaveRoom();
      cleanupMedia();
    };
  }, []);

  // Log when invitation state changes
  useEffect(() => {
    if (incomingInvitation) {
      console.log('Invitation state updated in main component:', incomingInvitation);
      console.log('Modal visibility state:', showInvitationModal);
    }
  }, [incomingInvitation, showInvitationModal]);

  // Get the active stream
  const activeStream =
    activeVideoId
      ? remotePeers.find((p) => p.peerId === activeVideoId)?.stream ||
      (localStreamRef.current && activeVideoId === 'local' ? localStreamRef.current : null)
      : null;

  // Create a wrapper component that will always be rendered
  const renderInvitationModal = () => {
    if (showInvitationModal && incomingInvitation) {
      console.log('Rendering invitation modal with states:', {
        acceptingInvitation,
        error: invitationError
      });

      return (
        <InvitationModal
          invitation={incomingInvitation}
          onAccept={handleAcceptInvitation}
          onDecline={handleDeclineInvitation}
          isLoading={acceptingInvitation}
          error={invitationError}
        />
      );
    }
    return null;
  };

  // Add additional debugging for peer connections
  useEffect(() => {
    if (remotePeers.length > 0) {
      console.log('Remote peers updated:', remotePeers);
      console.log('Number of remote peers:', remotePeers.length);
      remotePeers.forEach(peer => {
        console.log(`Peer ${peer.peerId} has tracks:`, peer.stream.getTracks().length);
        peer.stream.getTracks().forEach(track => {
          console.log(`Track kind: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
        });
      });
    }
  }, [remotePeers]);

  // Ensure video refs are properly set
  useEffect(() => {
    // Force reattachment of video elements when streams change
    const reattachVideos = () => {
      // Force reattach if needed
      if (activeVideoId && activeStream) {
        console.log(`Ensuring active video is attached for ${activeVideoId}`);
      }
    };

    reattachVideos();
  }, [activeVideoId, activeStream, remotePeers]);

  // Add at the end of the component, right before the final return statement
  const renderMeetingRoom = () => (
    <div className="meeting-room">
      <div className="main-area">
        <MainVideo activeStream={activeStream} activeVideoId={activeVideoId} />
      </div>

      <div className="participants-strip">
        <ParticipantVideo
          stream={localStreamRef.current!}
          peerId="local"
          isActive={activeVideoId === 'local'}
          isLocal={true}
          onClick={() => setActiveVideoId('local')}
        />

        {remotePeers.map(({ peerId, stream }) => (
          <ParticipantVideo
            key={peerId}
            stream={stream}
            peerId={peerId}
            isActive={activeVideoId === peerId}
            onClick={() => setActiveVideoId(peerId)}
          />
        ))}
      </div>

      <ControlBar
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onOpenInvite={() => setShowInviteModal(true)}
        onDisconnect={handleDisconnect}
        onOpenSettings={() => setShowConfigModal(true)}
      />

      {/* Add connection debugger */}
      <ConnectionDebugger
        socketConnected={!!socket && socket.connected}
        mediasoupLoaded={!!useWebRTC}
        remotePeers={remotePeers}
        roomId={roomId}
        peerId={peerId}
      />

      {/* Render invite modal only in meeting room */}
      {showInviteModal && (
        <InviteModal
          inviteUserIds={inviteUserIds}
          setInviteUserIds={setInviteUserIds}
          invitationStatus={invitationStatus}
          onClose={() => setShowInviteModal(false)}
          onSubmit={handleInviteSubmit}
        />
      )}

      {/* Settings panel removed for bandwidth optimization */}
      {/* 
      <div className="settings-panel">
        <div className="setting-group">
          <label>Video Quality:</label>
          <select 
            value={currentResolution} 
            onChange={async (e) => {
              const newResolution = e.target.value as 'low' | 'medium' | 'high';
              setCurrentResolution(newResolution);
              
              // If already in a call, update the stream with new resolution
              if (isJoined && localStreamRef.current) {
                try {
                  const newStream = await getMediaStream(newResolution);
                  if (localVideoRef.current) {
                    localVideoRef.current.srcObject = newStream;
                  }
                  // You may need to update the published stream here depending on your WebRTC implementation
                } catch (error) {
                  console.error('Failed to update resolution during call:', error);
                }
              }
            }}
          >
            <option value="low">Low (640x360) - Limited Bandwidth</option>
            <option value="medium">Medium (1280x720)</option>
            <option value="high">High (1920x1080)</option>
          </select>
        </div>
        
        <div className="setting-group">
          <label>Preferred Codec:</label>
          <select 
            value={preferredCodec} 
            onChange={(e) => setPreferredCodec(e.target.value as 'vp8' | 'vp9' | 'h264' | 'h265')}
          >
            <option value="h265">H.265 (HEVC) - Limited Support</option>
            <option value="h264">H.264 - Better Compatibility</option>
            <option value="vp9">VP9 - Good Quality/Compression</option>
            <option value="vp8">VP8 - Fallback</option>
          </select>
        </div>
      </div>
      */}
      {/* Add StatsMonitor component */}
      <StatsMonitor stats={connectionStats} />

      {/* Debug button for connection stats */}
      <button
        className="debug-button"
        onClick={debugStats}
        style={{ position: 'absolute', bottom: '10px', left: '10px', zIndex: 100 }}
      >
        Debug Stats
      </button>
    </div>
  );

  const debugStats = () => {
    console.log("Current connection stats:", connectionStats);

    // Count connections
    const connectionCount = Object.keys(connectionStats).length;

    if (connectionCount === 0) {
      alert("No WebRTC stats available. Make sure connections are established.");
    } else {
      alert(`WebRTC stats available for ${connectionCount} connections. Check console for details.`);
    }
  };

  // Modify the return statement to use the renderMeetingRoom function
  return (
    <>
      {renderInvitationModal()}

      {showConfigModal ? (
        <ConfigurationModal
          wsIP={wsIP}
          setWsIP={setWsIP}
          userId={userId}
          setUserId={setUserId}
          onSubmit={handleConfigSubmit}
          onDisconnect={handleManualDisconnect}
          hasActiveConnection={!!socket}
        />
      ) : !socket ? (
        <div className="loading-screen">
          <p>Initializing connection...</p>
          <button onClick={() => setShowConfigModal(true)}>Configure Connection</button>
        </div>
      ) : !isJoined ? (
        <div className="join-screen">
          <div className="join-container">
            <h1>Video Conference</h1>
            <div className="join-preview">
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>
            <div className="join-form">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter meeting code"
              />
              <button onClick={handleJoinRoom}>Join Meeting</button>
            </div>
            <div className="config-button">
              <button onClick={() => setShowConfigModal(true)}>Change Connection Settings</button>
            </div>
          </div>
        </div>
      ) : renderMeetingRoom()}
    </>
  );
}

