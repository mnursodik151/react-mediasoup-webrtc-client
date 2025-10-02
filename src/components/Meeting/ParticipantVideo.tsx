import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import SetConsumerLayersForm from './SetConsumerLayersForm';

interface ParticipantVideoProps {
  stream: MediaStream;
  peerId: string;
  isActive: boolean;
  isLocal?: boolean;
  onClick: () => void;
  username?: string;
  avatar?: string;
  producerId?: string;
  socket?: Socket | null;
  myPeerId?: string; // optional: current user's peer id (used as initiatorPeerId)
  onMediaControlResponse?: (data: any) => void;
}

const ParticipantVideo: React.FC<ParticipantVideoProps> = ({
  stream,
  peerId,
  isActive,
  isLocal = false,
  onClick,
  username,
  avatar,
  producerId,
  socket,
  myPeerId,
  onMediaControlResponse
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [showLayersModal, setShowLayersModal] = useState(false);

  // Keep a stable handler reference for cleanup
  useEffect(() => {
    return () => {
      // remove any one-time listeners that might remain
      try {
        if (socket) {
          socket.off('mediaControlInitiated');
        }
      } catch (e) {
        // ignore
      }
    };
  }, [socket]);

  useEffect(() => {
  const attachStream = async () => {
      if (videoRef.current && stream) {
        try {
          if (videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream;
            if (videoRef.current.paused) {
              try {
                await videoRef.current.play();
              } catch (err) {
                // ignore
              }
            }
          }
        } catch (err) {
          // ignore
        }
      }
    };
    attachStream();
  }, [peerId, stream]);

  // Handler when the participant tile is clicked
  const handleSelect = () => {
    // existing onClick behavior (e.g. set active video)
    try {
      onClick();
    } catch (e) {
      // ignore
    }

    // Emit initiateMediaControl to server
    if (socket) {
      const initiator = (typeof (socket as any).peerId === 'string' && (socket as any).peerId) ||
                        (typeof (socket as any).id === 'string' && (socket as any).id) ||
                        (typeof (socket as any).io === 'object' && (socket as any).io.opts && (socket as any).io.opts.query && (socket as any).io.opts.query.peerId) ||
                        myPeerId ||
                        null;

      const payload = {
        initiatorPeerId: initiator,
        targetPeerId: peerId,
      };

      // Log what we're sending for debugging
      console.log('Sending initiateMediaControl', payload);
      socket.emit('initiateMediaControl', payload);

      // Listen once for the server acknowledgement broadcast
      socket.once('mediaControlInitiated', (data: any) => {
        console.log('mediaControlInitiated received from server:', data);
        if (onMediaControlResponse) onMediaControlResponse(data);
      });
    } else {
      console.warn('Socket not available - cannot initiate media control');
      if (onMediaControlResponse) {
        onMediaControlResponse({ error: 'Socket not available - cannot initiate media control', targetPeerId: peerId });
      }
    }
  };

  useEffect(() => {
    // Get the first video track and its settings
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      if (settings.width && settings.height) {
        setResolution({ width: settings.width, height: settings.height });
      } else {
        // fallback: update on loadedmetadata
        const video = videoRef.current;
        if (video) {
          video.addEventListener('loadedmetadata', () => {
            console.log(video.videoWidth, video.videoHeight);
            // Now getSettings() may also have width/height
            const track = stream.getVideoTracks()[0];
            console.log(track.getSettings());
            setResolution({
              width: video.videoWidth,
              height: video.videoHeight
            });
          });
        }
      }
    }
  }, [stream]);

  return (
    <div
      className={`participant-tile ${isActive ? 'active' : ''}`}
      onClick={handleSelect}
      style={{ position: 'relative' }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={{ width: '100%', height: '100%' }}
      />
      <div className="participant-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isLocal ? (
          'You'
        ) : (
          <>
            {avatar && (
              <img
                src={avatar}
                alt={username || 'avatar'}
                style={{ width: 24, height: 24, borderRadius: '50%', marginRight: 4 }}
              />
            )}
            <span>{username || `Peer ${peerId.substring(0, 6)}...`}</span>
          </>
        )}
      </div>
      {/* Add a track counter for debugging */}
      <div className="track-counter" style={{
        position: 'absolute',
        top: '5px',
        right: '5px',
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        padding: '2px 5px',
        fontSize: '10px',
        borderRadius: '3px'
      }}>
        Tracks: {stream?.getTracks().length || 0}
      </div>
      {/* Metadata stats */}
      <div className="video-meta" style={{
        position: 'absolute',
        bottom: 5,
        right: 5,
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        padding: '2px 6px',
        borderRadius: '3px',
        fontSize: '10px'
      }}>
        {resolution && (
          <span>
            {resolution.width}x{resolution.height}
          </span>
        )}
      </div>
      {/* Set Consumer Preferred Layers Modal (remote only) */}
      {!isLocal && producerId && socket && (
        <>
          <button
            style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 2, fontSize: 10, padding: '2px 8px' }}
            onClick={e => { e.stopPropagation(); setShowLayersModal(true); }}
          >
            Set Layers
          </button>
          {showLayersModal && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000
              }}
              onClick={() => setShowLayersModal(false)}
            >
              <div
                style={{ background: '#222', padding: 20, borderRadius: 8, minWidth: 220, position: 'relative' }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  style={{ position: 'absolute', top: 6, right: 8, background: 'none', color: '#fff', border: 'none', fontSize: 16, cursor: 'pointer' }}
                  onClick={() => setShowLayersModal(false)}
                  aria-label="Close"
                >
                  ×
                </button>
                <h5 style={{ color: '#fff', margin: '0 0 8px 0', fontSize: 14 }}>Set Layers for producerId {producerId}</h5>
                <SetConsumerLayersForm producerId={producerId} socket={socket} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ParticipantVideo;
