import React, { useEffect, useRef, useState, useMemo } from 'react';

interface PeerStream {
  peerId: string;
  stream: MediaStream;
}

interface MainVideoProps {
  activeStream: MediaStream | null;
  activeVideoId: string | null;
  remotePeers?: PeerStream[]; // Pass remotePeers as prop
}

const MainVideo: React.FC<MainVideoProps> = ({ activeStream, activeVideoId, remotePeers = [] }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);

  // Find the participant info for the active video
  const participant = useMemo(() => {
    if (!activeVideoId || activeVideoId === 'local') return null;
    return remotePeers.find(p => p.peerId === activeVideoId) || null;
  }, [activeVideoId, remotePeers]);

  useEffect(() => {
    if (videoRef.current && activeStream) {
      if (videoRef.current.srcObject !== activeStream) {
        videoRef.current.srcObject = activeStream;
      }
    }
  }, [activeStream]);

  useEffect(() => {
    // Use track.getSettings() from the participant's video track if available
    let cleanup: (() => void) | undefined;
    if (participant && participant.stream) {
      const videoTrack = participant.stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        if (settings.width && settings.height) {
          setResolution({ width: settings.width, height: settings.height });
        } else {
          // fallback: update on loadedmetadata
          const video = videoRef.current;
          if (video) {
            const handleLoadedMetadata = () => {
              setResolution({
                width: video.videoWidth,
                height: video.videoHeight,
              });
            };
            video.addEventListener('loadedmetadata', handleLoadedMetadata);
            cleanup = () => {
              video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            };
          }
        }
      }
    } else if (activeVideoId === 'local' && activeStream) {
      // For local, fallback to loadedmetadata
      const video = videoRef.current;
      if (video) {
        const handleLoadedMetadata = () => {
          setResolution({
            width: video.videoWidth,
            height: video.videoHeight,
          });
        };
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        cleanup = () => {
          video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
      }
    } else {
      setResolution(null);
    }
    return cleanup;
  }, [participant, activeVideoId, activeStream]);

  if (!activeStream) {
    return <div className="no-video">No active video selected</div>;
  }

  return (
    <div className="main-video-container">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ maxWidth: '100%', maxHeight: '100%' }}
      />
      <div className="video-name">
        {activeVideoId === 'local' ? 'You' : `Participant (${activeVideoId})`}
      </div>
      {/* Metadata stats */}
      <div className="video-meta" style={{
        position: 'absolute',
        bottom: 10,
        right: 10,
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px'
      }}>
        {resolution && (
          <span>
            {resolution.width}x{resolution.height}
          </span>
        )}
      </div>
    </div>
  );
};

export default MainVideo;
