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
import DoodleSpace, { DrawEvent, ClearEvent } from '../components/DoodleSpace';

// Import hooks
import { useSocket } from '../hooks/useSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { useWebRTCDataChannel } from '../hooks/useWebRTCDataChannel';

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
    preferredCodec,
    setPreferredCodec,
    connectionStats, // Add this line
    mediasoupDevice
  } = useWebRTC(socket);

  const {
    isConnected: isDoodleConnected,
    initializeDataChannel,
    cleanupDataChannel,
    sendData: sendDoodleData,
    receivedData: receivedDoodleData,
    clearReceivedData: clearDoodleData
  } = useWebRTCDataChannel(socket);

  // Local state for UI
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [inviteUserIds, setInviteUserIds] = useState<string>('');
  const [invitationStatus, setInvitationStatus] = useState<string>('');
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const [doodleEvents, setDoodleEvents] = useState<Array<DrawEvent | ClearEvent>>([]);
  const dataChannelInitializedRef = useRef(false);

  // Add a state for invitation acceptance process
  const [acceptingInvitation, setAcceptingInvitation] = useState<boolean>(false);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  // Add these states near your existing state declarations
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [savedRoomState, setSavedRoomState] = useState<{
    roomId: string;
    peerId: string;
  } | null>(null);

  // Toast for media control notifications
  const [mediaControlToast, setMediaControlToast] = useState<string | null>(null);

  // Listen for server responses
  useEffect(() => {
    if (!socket) return;
    const onMediaControlInitiated = (data: { targetPeerId: string }) => {
      // Show a temporary toast
      const msg = `Media control initiated for ${data.targetPeerId}`;
      console.log('mediaControlInitiated (page):', data);
      setMediaControlToast(msg);
      setTimeout(() => setMediaControlToast(null), 3500);
    };

    socket.on('mediaControlInitiated', onMediaControlInitiated);
    const onLayersSet = (data: { producerId: string; spatialLayer: number; temporalLayer: number }) => {
      console.log('consumerLayersSet', data);
    };
    const onLayersError = (data: { producerId: string; error: string }) => {
      console.warn('consumerLayersError', data);
    };
    socket.on('consumerLayersSet', onLayersSet);
    socket.on('consumerLayersError', onLayersError);
    return () => {
      socket.off('consumerLayersSet', onLayersSet);
      socket.off('consumerLayersError', onLayersError);
      socket.off('mediaControlInitiated', onMediaControlInitiated);
    };
  }, [socket]);

  // Add this function to check browser compatibility
  const checkMediaDeviceSupport = () => {
    if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        supported: false,
        reason: "Your browser does not support media devices access. Please use a modern browser like Chrome, Firefox, or Edge."
      };
    }
    return { supported: true };
  };

  // Add this effect to monitor resolution changes
  useEffect(() => {
    console.log(`Resolution state changed to: ${currentResolution}`);
  }, [currentResolution]);

  useEffect(() => {
    if (!socket || !isJoined || !peerId || !roomId || !mediasoupDevice) {
      return;
    }

    if (dataChannelInitializedRef.current) {
      return;
    }

    initializeDataChannel({ roomId, peerId, device: mediasoupDevice });
    dataChannelInitializedRef.current = true;
  }, [socket, isJoined, peerId, roomId, mediasoupDevice, initializeDataChannel]);

  useEffect(() => {
    if (!isJoined) {
      if (dataChannelInitializedRef.current) {
        dataChannelInitializedRef.current = false;
        cleanupDataChannel();
      }

      if (doodleEvents.length) {
        setDoodleEvents([]);
      }
    }
  }, [isJoined, cleanupDataChannel, doodleEvents.length]);

  useEffect(() => {
    if (!receivedDoodleData || receivedDoodleData.length === 0) {
      return;
    }

    const normalizedEvents: Array<DrawEvent | ClearEvent> = receivedDoodleData
      .map((rawEvent) => {
        try {
          const parsed = typeof rawEvent === 'string' ? JSON.parse(rawEvent) : rawEvent;
          return {
            ...parsed,
            timestamp: parsed?.timestamp ?? Date.now(),
            source: parsed?.source ?? 'remote',
          } as DrawEvent | ClearEvent;
        } catch (error) {
          console.error('Failed to parse doodle event payload:', error);
          return null;
        }
      })
      .filter((event): event is DrawEvent | ClearEvent => event !== null);

    setDoodleEvents((prev) => [...prev, ...normalizedEvents]);
    clearDoodleData();
  }, [receivedDoodleData, clearDoodleData]);

  const handleBroadcastDoodle = (event: DrawEvent | ClearEvent) => {
    const enrichedEvent: DrawEvent | ClearEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
      source: 'local',
    };

    setDoodleEvents((prev) => [...prev, enrichedEvent]);

    const sent = sendDoodleData(enrichedEvent);
    if (!sent) {
      console.warn('Failed to send doodle event - data channel may be unavailable');
    }
  };

  // Handle joining a room
  const handleJoinRoom = async () => {
    if (!socket) {
      alert('Socket connection not established. Please configure connection settings first.');
      setShowConfigModal(true);
      return;
    }

    // Check browser compatibility before attempting to access media
    const mediaSupport = checkMediaDeviceSupport();
    if (!mediaSupport.supported) {
      alert(mediaSupport.reason);
      return;
    }

    try {
      console.log('Requesting user media...');
      
      // Set default codec and resolution when getting first media stream
      const initialCodec = 'vp8';
      const initialResolution = 'medium';
      
      console.log(`Setting initial resolution to ${initialResolution} and codec to ${initialCodec}`);
      setPreferredCodec(initialCodec); 
      setCurrentResolution(initialResolution);
      
      // Wait for state updates to propagate
      await new Promise(resolve => setTimeout(resolve, 0));
      
      console.log(`Getting media stream with resolution: ${initialResolution}`);
      const stream = await getMediaStream(initialResolution).catch(error => {
        console.error('Media access error:', error);
        
        // Handle permission denied errors specifically
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          throw new Error('Camera/microphone permission denied. Please allow access to join with video.');
        }
        
        throw error; // Re-throw other errors
      });
      
      console.log('User media obtained:', stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(error => {
          console.warn('Error playing local video:', error);
        });
        console.log('Local video stream set.');
      }

      await joinRoom(stream, roomId, userId);
    } catch (error) {
      console.error('Error joining room:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error accessing media devices';
      
      // Ask user if they want to proceed without media
      if (window.confirm(`${errorMessage}\n\nWould you like to join without camera/microphone?`)) {
        // Join with empty stream or audio only as fallback
        try {
          // Try to join with audio only if video failed
          const audioOnlyStream = await navigator.mediaDevices
            .getUserMedia({ audio: true, video: false })
            .catch(() => null);
            
          if (audioOnlyStream) {
            await joinRoom(audioOnlyStream, roomId, userId);
          } else {
            console.error('Failed to get audio stream');
            alert('Could not access microphone. Join canceled.');
          }
        } catch (fallbackError) {
          console.error('Failed to join with fallback options:', fallbackError);
          alert('Could not join meeting. Please check your device permissions and try again.');
        }
      }
    }
  };

  // Handle disconnect/leaving room
  const handleDisconnect = () => {
    leaveRoom();
    cleanupMedia();
    cleanupDataChannel();
    dataChannelInitializedRef.current = false;
    setDoodleEvents([]);
  };

  // Handle manual socket disconnection from config modal
  const handleManualDisconnect = () => {
    disconnectSocket();
    cleanupDataChannel();
    dataChannelInitializedRef.current = false;
    setDoodleEvents([]);
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
      cleanupDataChannel();
      dataChannelInitializedRef.current = false;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      leaveRoom();
      cleanupMedia();
      cleanupDataChannel();
      dataChannelInitializedRef.current = false;
    };
  }, [leaveRoom, cleanupMedia, cleanupDataChannel]);

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
          invitation={{
            ...incomingInvitation,
            inviterProfile: incomingInvitation.inviterProfile || { username: 'Unknown', avatarUrl: '' }
          }}
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
  const renderMeetingRoom = () => {
    // Add this code inside your renderMeetingRoom function, before the return statement
    const renderSettingsPanel = () => (
      <div className="settings-panel">
        <div className="setting-group">
          <label>Video Quality:</label>
          <select 
            value={currentResolution} 
            onChange={(e) => {
              const newResolution = e.target.value as 'low' | 'medium' | 'high';
              console.log(`User selected resolution: ${newResolution}`);
              reconfigureMediaStream(newResolution, preferredCodec);
            }}
            disabled={isReconnecting}
          >
            <option value="low">Low (640x360) - Limited Bandwidth</option>
            <option value="medium">Medium (1280x720)</option>
            <option value="high">High (1920x1080)</option>
          </select>
          <div className="current-setting">Current: {currentResolution}</div>
        </div>
        
        <div className="setting-group">
          <label>Video Codec:</label>
          <select 
            value={preferredCodec} 
            onChange={(e) => {
              const newCodec = e.target.value as 'vp8' | 'vp9' | 'h264' | 'h265';
              console.log(`User selected codec: ${newCodec}`);
              reconfigureMediaStream(currentResolution, newCodec);
            }}
            disabled={isReconnecting}
          >
            <option value="h265">H.265 (HEVC) - Better Quality</option>
            <option value="h264">H.264 - Good Compatibility</option>
            <option value="vp9">VP9 - Good Compression</option>
            <option value="vp8">VP8 - Best Compatibility</option>
          </select>
          <div className="current-setting">Current: {preferredCodec}</div>
        </div>
      </div>
    );

    return (
      <div className="meeting-room">
        <div className="main-area">
          <div className="main-area-content">
            <div className="main-video-pane">
              <MainVideo activeStream={activeStream} activeVideoId={activeVideoId} />
            </div>
            <div className="doodle-pane">
              <div className={`doodle-status-badge ${isDoodleConnected ? 'connected' : 'disconnected'}`}>
                {isDoodleConnected ? 'Shared doodle connected' : 'Shared doodle offline'}
              </div>
              {!isDoodleConnected && (
                <div className="doodle-help-text">
                  Drawings sync automatically once the data channel reconnects.
                </div>
              )}
              <DoodleSpace
                broadcastDoodleEvent={handleBroadcastDoodle}
                doodleEvents={doodleEvents}
                width={420}
                height={320}
                className="doodle-space-card"
              />
            </div>
          </div>
        </div>

        <div className="participants-strip">
          <ParticipantVideo
            stream={localStreamRef.current!}
            peerId="local"
            isActive={activeVideoId === 'local'}
            isLocal={true}
            onClick={() => setActiveVideoId('local')}
            socket={socket}
            myPeerId={peerId}
          />

          {remotePeers.map(({ peerId: remotePeerId, stream, userProfile, producerId: producerId }) => (
            <ParticipantVideo
              key={remotePeerId}
              stream={stream}
              peerId={remotePeerId}
              isActive={activeVideoId === remotePeerId}
              onClick={() => setActiveVideoId(remotePeerId)}
              username={userProfile?.username}
              avatar={userProfile?.avatar}
              producerId={producerId}
              socket={socket}
              myPeerId={peerId}
              onMediaControlResponse={(data: any) => {
                const msg = data && data.targetPeerId ? `Media control accepted for ${data.targetPeerId}` : `Media control response: ${JSON.stringify(data)}`;
                setMediaControlToast(msg);
                setTimeout(() => setMediaControlToast(null), 3500);
              }}
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

        {/* Add the new settings panel */}
        {renderSettingsPanel()}

        {/* Existing components */}
        <ConnectionDebugger
          socketConnected={!!socket && socket.connected}
          mediasoupLoaded={!!useWebRTC}
          remotePeers={remotePeers}
          roomId={roomId}
          peerId={peerId}
        />

        {/* Existing modals and components */}
        {showInviteModal && (
          <InviteModal
            inviteUserIds={inviteUserIds}
            setInviteUserIds={setInviteUserIds}
            invitationStatus={invitationStatus}
            onClose={() => setShowInviteModal(false)}
            onSubmit={handleInviteSubmit}
          />
        )}

        <StatsMonitor stats={connectionStats} />

        {/* Debug button */}
        <button
          className="debug-button"
          onClick={debugStats}
          style={{ position: 'absolute', bottom: '10px', left: '10px', zIndex: 100 }}
        >
          Debug Stats
        </button>
        {/* Media control toast */}
        {mediaControlToast && (
          <div style={{ position: 'fixed', right: 12, bottom: 80, background: '#222', color: '#fff', padding: '8px 12px', borderRadius: 6, zIndex: 200 }}>
            {mediaControlToast}
          </div>
        )}
      </div>
    );
  };

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

  // Add this function to your component
  const reconfigureMediaStream = async (
    newResolution: 'low' | 'medium' | 'high' = currentResolution,
    newCodec: 'vp8' | 'vp9' | 'h264' | 'h265' = preferredCodec
  ) => {
    if (!isJoined || !socket) {
      console.error('Cannot reconfigure: Not in a meeting');
      return;
    }

    try {
      // Save current room state
      setSavedRoomState({
        roomId: roomId,
        peerId: peerId
      });

      // Show reconnection UI
      setIsReconnecting(true);

      console.log(`Reconfiguring media with resolution: ${newResolution}, codec: ${newCodec}`);
      
      // Update codec and resolution
      setPreferredCodec(newCodec);
      setCurrentResolution(newResolution);
      
      // Wait for state updates to propagate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify settings before proceeding
      console.log(`Verified settings - Resolution: ${newResolution}, Codec: ${newCodec}`);
      
      // Disconnect and clean up
      leaveRoom();
      cleanupMedia();
      
      // Wait a bit to ensure proper cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get new media stream with explicit resolution parameter
      console.log(`Getting new media stream with resolution: ${newResolution}`);
      const newStream = await getMediaStream(newResolution);
      
      console.log(`Media stream obtained with tracks:`, 
        newStream.getTracks().map(t => `${t.kind} (${t.getSettings().width}x${t.getSettings().height})`));
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;
        console.log('Local video updated with new stream');
      }
      
      // Rejoin with new settings
      console.log(`Rejoining room with resolution: ${newResolution}, codec: ${newCodec}`);
      await joinRoom(newStream, savedRoomState?.roomId);
      
      console.log('Media reconfiguration complete!');
    } catch (error) {
      console.error('Error during media reconfiguration:', error);
      alert('Failed to update media settings. Please try again.');
    } finally {
      setIsReconnecting(false);
    }
  };

  // Add this inside your component's main return statement, right before the final meeting room render
  const renderReconnectingState = () => {
    if (isReconnecting) {
      return (
        <div className="reconnecting-overlay">
          <div className="reconnecting-dialog">
            <div className="spinner"></div>
            <h3>Updating Media Settings</h3>
            <p>Please wait while we reconnect your call with new settings...</p>
          </div>
        </div>
      );
    }
    return null;
  };

  // Modify the return statement to include the reconnecting overlay
  return (
    <>
      {renderInvitationModal()}
      {renderReconnectingState()}

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
            
            {/* Media access prompt/notice */}
            <div className="media-access-notice">
              <p>📹🎤 This application will request access to your camera and microphone when you join.</p>
              <p>Please click "Allow" when prompted by your browser to enable video conferencing.</p>
            </div>
            
            <div className="join-preview">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <div className="media-error-overlay" id="mediaErrorMessage" style={{display: 'none'}}>
                <p>Camera access error</p>
                <button onClick={() => {
                  document.getElementById('mediaErrorMessage')!.style.display = 'none';
                  handleJoinRoom();
                }}>
                  Retry Camera Access
                </button>
              </div>
            </div>
            
            {/* Add device selection options */}
            <div className="media-settings">
              <p>Default settings: Medium quality (720p) with VP8 codec</p>
              <p>You can change these settings after joining the meeting</p>
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

