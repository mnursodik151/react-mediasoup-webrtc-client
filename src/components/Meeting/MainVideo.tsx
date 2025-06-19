import React, { useEffect, useRef, useState } from 'react';

interface MainVideoProps {
  activeStream: MediaStream | null;
  activeVideoId: string | null;
}

const MainVideo: React.FC<MainVideoProps> = ({ activeStream, activeVideoId }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [codec, setCodec] = useState<string | null>(null);

  useEffect(() => {
    if (videoRef.current && activeStream) {
      if (videoRef.current.srcObject !== activeStream) {
        videoRef.current.srcObject = activeStream;
      }
    }
  }, [activeStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setResolution({
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    // Try to get codec info using WebRTC stats (if available)
    // const getCodecInfo = async () => {
    //   // @ts-ignore
    //   const sender = (activeStream?.getVideoTracks?.() || []).length && window.debugRTC?.transports?.videoSend?.pc?.getSenders?.()
    //     ? window.debugRTC.transports.videoSend.pc.getSenders().find((s: RTCRtpSender) => s.track === activeStream.getVideoTracks()[0])
    //     : null;
    //   if (sender && sender.getStats) {
    //     const stats = await sender.getStats();
    //     stats.forEach((report: any) => {
    //       if (report.type === 'outbound-rtp' && report.codecId) {
    //         const codecReport = stats.get(report.codecId);
    //         if (codecReport && codecReport.mimeType) {
    //           setCodec(codecReport.mimeType);
    //         }
    //       }
    //     });
    //   }
    // };

    // getCodecInfo();

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
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
        {/* {codec && (
          <span style={{ marginLeft: 8 }}>
            Codec: {codec}
          </span>
        )} */}
      </div>
    </div>
  );
};

export default MainVideo;
