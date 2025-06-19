import React, { useEffect, useRef, useState } from 'react';

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
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [codec, setCodec] = useState<string | null>(null);

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
    //   const receiver = (stream?.getVideoTracks?.() || []).length && window.debugRTC?.transports?.videoSend?.pc?.getReceivers?.()
    //     ? window.debugRTC.transports.videoSend.pc.getReceivers().find((r: RTCRtpReceiver) => r.track === stream.getVideoTracks()[0])
    //     : null;
    //   if (receiver && receiver.getStats) {
    //     const stats = await receiver.getStats();
    //     stats.forEach((report: any) => {
    //       if (report.type === 'inbound-rtp' && report.codecId) {
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
  }, [stream]);

  return (
    <div
      className={`participant-tile ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{ position: 'relative' }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={{ width: '100%', height: '100%' }}
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
        {/* {codec && (
          <span style={{ marginLeft: 6 }}>
            Codec: {codec}
          </span>
        )} */}
      </div>
    </div>
  );
};

export default ParticipantVideo;
