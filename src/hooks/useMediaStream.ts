import { useState, useRef, useCallback } from 'react';

export const useMediaStream = () => {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // Add resolution configuration
  const [currentResolution, setCurrentResolution] = useState<'low' | 'medium' | 'high'>('medium');

  const getMediaStream = async (resolution: 'low' | 'medium' | 'high' = 'medium'): Promise<MediaStream> => {
    try {
      // Store the selected resolution
      setCurrentResolution(resolution);
      
      // Define resolution presets
      const resolutionPresets = {
        low: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } },
        medium: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        high: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
      };
      
      const constraints = {
        video: {
          facingMode: 'user',
          ...resolutionPresets[resolution]
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      console.log(`Requesting media with ${resolution} resolution constraints:`, constraints);
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

  // Add this function inside the useMediaStream hook
  const updateResolution = useCallback(async (newResolution: 'low' | 'medium' | 'high') => {
    if (newResolution !== currentResolution) {
      console.log(`Updating resolution from ${currentResolution} to ${newResolution}`);
      
      // Stop current stream if it exists
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Get new stream with updated resolution
      try {
        const newStream = await getMediaStream(newResolution);
        return newStream;
      } catch (error) {
        console.error('Failed to update resolution:', error);
        throw error;
      }
    }
    
    return localStreamRef.current;
  }, [currentResolution, getMediaStream]);

  // Add updateResolution to the return object
  return {
    localStreamRef,
    isMuted,
    isVideoOff,
    currentResolution,
    setCurrentResolution,
    getMediaStream,
    updateResolution, // Add this new function
    toggleMute,
    toggleVideo,
    cleanupMedia
  };
};
