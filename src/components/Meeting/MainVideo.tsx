import React, { useEffect, useRef } from 'react';

interface MainVideoProps {
  activeStream: MediaStream | null;
  activeVideoId: string | null;
}

const MainVideo: React.FC<MainVideoProps> = ({ activeStream, activeVideoId }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && activeStream) {
      if (videoRef.current.srcObject !== activeStream) {
        videoRef.current.srcObject = activeStream;
      }
    }
  }, [activeStream]);

  if (!activeStream) {
    return <div className="no-video">No active video selected</div>;
  }

  return (
    <div className="main-video-container">
      <video
        ref={videoRef}
        autoPlay
        playsInline
      />
      <div className="video-name">
        {activeVideoId === 'local' ? 'You' : `Participant (${activeVideoId})`}
      </div>
    </div>
  );
};

export default MainVideo;
