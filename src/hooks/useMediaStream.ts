import { useState, useRef, useCallback } from 'react';

export const useMediaStream = () => {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // Track the currently applied resolution for the local stream
  const [currentResolution, setCurrentResolution] = useState<'low' | 'medium' | 'high'>('low');

  const getMediaStream = async (resolution: 'low' | 'medium' | 'high' = 'medium'): Promise<MediaStream> => {
    try {
      const actualResolution = resolution;
      setCurrentResolution(actualResolution);
      
      // Define resolution presets
      const resolutionPresets = {
        low: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } },
        medium: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        high: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
      };
      
      const constraints = {
        video: {
          facingMode: 'user',
          ...resolutionPresets[actualResolution]
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
  console.log(`Requesting media stream at ${actualResolution} resolution:`, constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      console.log('Media stream obtained:', stream, 'with actual resolution:', 
        stream.getVideoTracks()[0].getSettings());
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  };

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = isVideoOff;
      });
      setIsVideoOff(!isVideoOff);
    }
  }, [isVideoOff]);

  const cleanupMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('Stopped local track:', track.kind);
      });
      localStreamRef.current = null;
    }
  }, []);

  return {
    localStreamRef,
    isMuted,
    isVideoOff,
    currentResolution,
    setCurrentResolution,
    getMediaStream,
    toggleMute,
    toggleVideo,
    cleanupMedia
  };
};
