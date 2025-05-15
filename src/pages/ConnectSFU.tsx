import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Transport } from 'mediasoup-client/types';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as React.CSSProperties['flexDirection'],
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#000', // Black background for FaceTime-like appearance
  },
  videoContainer: {
    position: 'relative' as 'relative',
    width: '100%',
    height: '80%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as React.CSSProperties['objectFit'], // Cover the entire container
    borderRadius: '10px',
  },
  localVideo: {
    position: 'absolute' as React.CSSProperties['position'],
    bottom: '10%',
    right: '5%',
    width: '20%',
    height: '20%',
    objectFit: 'cover' as React.CSSProperties['objectFit'],
    borderRadius: '10px',
    border: '2px solid white', // Add a white border for the local video
    boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)', // Add a shadow for better visibility
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '20px',
  },
  button: {
    padding: '10px 20px',
    fontSize: '16px',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: '#007AFF', // FaceTime-like blue button
    color: 'white',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
};

const ConnectSFU = () => {
  const videoRefSelf = useRef<HTMLVideoElement>(null);
  const videoRefOpp = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<any>(null); // Use useRef for socket
  const deviceRef = useRef<mediasoupClient.Device | null>(null); // Use useRef for device
  const transportRef = useRef<Transport | null>(null); // Use useRef for transport
  const videoProducer = useRef<any>(null);
  const audioProducer = useRef<any>(null);

  useEffect(() => {
    const socketInstance = io('http://localhost:9006', {
      transports: ['websocket'], // Force WebSocket transport
    });

    socketRef.current = socketInstance;

    socketInstance.on('connect', () => {
      console.log('Connected to signaling server');
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const initializeMediasoup = async () => {
    if (!socketRef.current) return;

    const deviceInstance = new mediasoupClient.Device();
    deviceRef.current = deviceInstance;

    socketRef.current.emit('getRouterRtpCapabilities', {}, (response: any) => {
      if (response.error) {
        console.error('Failed to get router RTP capabilities:', response.error);
        return;
      }

      deviceInstance.load({ routerRtpCapabilities: response }).then(() => {
        console.log('Mediasoup device loaded');
        createSendTransport(deviceInstance);
      });
    });
  };

  const createSendTransport = async (device: mediasoupClient.Device) => {
    if (!socketRef.current) return;

    socketRef.current.emit('createTransport', {}, (transportOptions: any) => {
      if (transportOptions.error) {
        console.error('Failed to create transport:', transportOptions.error);
        return;
      }

      const transport = device.createSendTransport(transportOptions);
      console.log('Send transport created:', transport.id);

      transportRef.current = transport;

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socketRef.current.emit(
          'connectTransport',
          { transportId: transportOptions.id, dtlsParameters },
          (response: any) => {
            if (response.error) {
              console.error('Failed to connect transport:', response.error);
              errback(response.error);
            } else {
              console.log('Send transport connected:', response.transportId);
              callback();
            }
          },
        );
      });

      transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        socketRef.current.emit(
          'produce',
          { transportId: transportOptions.id, kind, rtpParameters },
          (response: any) => {
            if (response.error) {
              console.error('Failed to produce:', response.error);
              errback(response.error);
            } else {
              console.log('Producer created:', response.id);
              callback({ id: response.id });
            }
          },
        );
      });

      transport.on('connectionstatechange', (state) => {
        console.log('Send transport connection state:', state);
      });

      captureMedia(transport);
    });
  };

  const captureMedia = async (transport: Transport) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack) {
        await transport.produce({ track: videoTrack }).then((producer) => {
          console.log('Video producer created:', producer.id);
          videoProducer.current = { id: producer.id, track: videoTrack };
        });
      }

      if (audioTrack) {
        await transport.produce({ track: audioTrack }).then((producer) => {
          console.log('Audio producer created:', producer.id);
          audioProducer.current = { id: producer.id, track: audioTrack };
        });
      }

      if (videoRefSelf.current) {
        videoRefSelf.current.srcObject = stream;
        videoRefSelf.current.play();
      }
    } catch (error) {
      console.error('Error capturing media:', error);
    }
  };

  const stopVideoProducer = () => {
    if (videoProducer) {
      socketRef.current.emit('closeProducer', { producerId: videoProducer.current.id }, (response: any) => {
        if (response.error) {
          console.error('Failed to close producer:', response.error);
        } else {
          console.log('Video producer closed:', response.id);
          videoProducer.current.track.stop(); // Stop the video track
        }
      });
      console.log('Video producer stopped');
      videoProducer.current = null;
    }
  };

  const stopAudioProducer = () => {
    if (audioProducer) {
      socketRef.current.emit('closeProducer', { producerId: audioProducer.current.id }, (response: any) => {
        if (response.error) {
          console.error('Failed to close producer:', response.error);
        } else {
          console.log('Audio producer closed:', response.id);
          audioProducer.current.track.stop(); // Stop the audio track
        }
      });
      console.log('Audio producer stopped');
      audioProducer.current = null;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.videoContainer}>
        <video
          ref={videoRefOpp}
          autoPlay
          playsInline
          controls
          style={styles.remoteVideo}
        />
        <video
          ref={videoRefSelf}
          autoPlay
          playsInline
          muted
          controls
          style={styles.localVideo}
        />
      </div>
      <div style={styles.controls}>
        <button onClick={initializeMediasoup} style={styles.button}>
          Start WebRTC Communication
        </button>
        <button
          onClick={() => stopVideoProducer()}
          disabled={!videoProducer.current}
          style={styles.button}
        >
          Stop Video
        </button>
        <button
          onClick={() => stopAudioProducer()}
          disabled={!audioProducer.current}
          style={styles.button}
        >
          Stop Audio
        </button>
      </div>
    </div>
  );
};

export default ConnectSFU;