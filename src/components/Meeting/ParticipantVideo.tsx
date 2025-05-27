import React, { useEffect, useRef } from 'react';

interface ParticipantVideoProps {
  stream: MediaStream;
  peerId: string;
  isActive: boolean;
  isLocal?: boolean;
  onClick: () => void;
}

const ParticipantVideo: React.FC<ParticipantVideoProps> = ({
  stream,
  peerId,
  isActive,
  isLocal = false,
  onClick
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const attachStream = async () => {
      if (videoRef.current && stream) {
        try {
          console.log(`Attaching stream for peer ${peerId} with ${stream.getTracks().length} tracks`);
          
          // Log the tracks for debugging
          stream.getTracks().forEach(track => {
            console.log(`Track for ${peerId}: kind=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
          });
          
          // Make sure video is not already playing this stream
          if (videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream;
            
            // Force play if needed
            if (videoRef.current.paused) {
              try {
                await videoRef.current.play();
                console.log(`Successfully playing video for peer ${peerId}`);
              } catch (err) {
                console.error(`Error playing video for peer ${peerId}:`, err);
              }
            }
          }
        } catch (err) {
          console.error(`Error attaching stream for peer ${peerId}:`, err);
        }
      }
    };
    
    attachStream();
  }, [peerId, stream]);

  return (
    <div
      className={`participant-tile ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
      />
      <div className="participant-name">
        {isLocal ? 'You' : `Peer ${peerId.substring(0, 6)}...`}
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
    </div>
  );
};

export default ParticipantVideo;
