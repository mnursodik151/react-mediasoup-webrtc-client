import { useState, useRef, useCallback, useEffect } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { Socket } from 'socket.io-client';

// Add platform detection
const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

// Conditional imports for React Native
let ReactNativeWebRTC: any = null;
if (isReactNative) {
  try {
    // In React Native, we would use 'react-native-webrtc'
    ReactNativeWebRTC = require('react-native-webrtc');
  } catch (e) {
    console.error('Failed to load react-native-webrtc:', e);
  }
}

// Create platform-agnostic WebRTC utility functions
const WebRTCUtils = {
  // Cross-platform function to create a MediaStream
  createMediaStream: (): MediaStream => {
    if (isReactNative && ReactNativeWebRTC) {
      return new ReactNativeWebRTC.MediaStream();
    }
    return new MediaStream();
  },

  // Cross-platform function to get media stats
  getStats: async (pc: RTCPeerConnection): Promise<RTCStatsReport> => {
    if (!pc) return new Map() as any;
    
    try {
      return await pc.getStats();
    } catch (e) {
      console.error('Error getting stats:', e);
      return new Map() as any;
    }
  },

// Platform-specific logging for peer connections
  logPeerConnection: (pc: RTCPeerConnection, description: string): void => {
    console.log(`[WebRTC][${isReactNative ? 'RN' : 'Web'}] ${description} connection state:`, 
      pc.connectionState || pc.iceConnectionState || 'unknown');
  },
  
  // Log ICE server configurations
  logIceServers: (servers: RTCIceServer[]): void => {
    console.log(`[WebRTC][${isReactNative ? 'RN' : 'Web'}] ICE/TURN servers configured:`, 
      servers.map(server => ({
        urls: server.urls,
        username: server.username ? '✓' : '✗',
        credential: server.credential ? '✓' : '✗'
      }))
    );
  }
};

// Helper function to log ICE server configurations
const logIceServers = (servers: RTCIceServer[]): void => {
  WebRTCUtils.logIceServers(servers);
};

export type PeerStream = {
  peerId: string;
  stream: MediaStream;
};

export const useWebRTC = (socket: Socket | null) => {
  // Add codec configuration
  const [preferredCodec, setPreferredCodec] = useState<'vp8' | 'vp9' | 'h264' | 'h265'>('vp8');
  
  const [roomId, setRoomId] = useState('');
  const [peerId, setPeerId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [remotePeers, setRemotePeers] = useState<PeerStream[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  
  const deviceRef = useRef<mediasoupClient.Device | null>(null);
  const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const peerStreams = useRef<Map<string, MediaStream>>(new Map());
  const candidateCounter = useRef<Record<string, number>>({}).current;

  // Add these at the beginning of the hook function
  const connectionStatsRef = useRef<Record<string, any>>({});
  const [connectionStats, setConnectionStats] = useState<Record<string, any>>({});

  const createSendTransport = useCallback(async (stream: MediaStream, peerIdentifier: string) => {
    if (!socket) return;
    
    console.log('Creating send transport...');

    // Remove any existing handlers for this event before adding new ones
    socket.off('transportCreated');

    // Use once instead of on to ensure the handler only executes once
    socket.once('transportCreated', async (options: any) => {
      console.log('Send transport options received:', options);

      // Check if turnServers are properly configured
      if (!options.turnServers || !options.turnServers.length) {
        console.error('[ICE] No TURN servers provided by the server!');
      } else {
        logIceServers(options.turnServers);
      }

      // Only create transport if it doesn't exist
      if (!sendTransportRef.current && deviceRef.current) {
        // Create platform-specific transport options
        const transportOptions = {
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          iceServers: options.turnServers,
          // Use platform-specific settings for ICE 
          ...(isReactNative ? {
            // React Native WebRTC specific options
            iceTransportPolicy: 'all' as RTCIceTransportPolicy, // React Native needs different settings
          } : {
            // Web browser specific options
            additionalIceParameters: {
              iceLite: false,
              iceControlling: true
            }
          })
        };
        
        console.log(`Creating send transport with TURN servers on ${isReactNative ? 'React Native' : 'Web'}:`, options.turnServers);
        const transport = deviceRef.current.createSendTransport(transportOptions);
        sendTransportRef.current = transport;

        // Platform-specific PeerConnection monitoring
        if (transport.handler) {
          const handler = transport.handler as any;
          const pc = handler.pc as RTCPeerConnection;
          
          if (pc) {
            // Use platform-agnostic monitoring
            const monitorInterval = monitorPeerConnection(pc, 'Send Transport');
            
            // Clean up the monitoring when the transport closes
            transport.on('connectionstatechange', (state) => {
              if (state === 'closed') {
                clearInterval(monitorInterval);
                // Remove stats when transport closes
                if (connectionStatsRef.current['Send Transport']) {
                  delete connectionStatsRef.current['Send Transport'];
                  setConnectionStats({...connectionStatsRef.current});
                }
              }
            });
          }
        }
        
        transport.on('connect', async ({ dtlsParameters }, callback) => {
          console.log('Send transport connecting...');
          socket.emit(
            'connectTransport',
            {
              transportId: transport.id,
              dtlsParameters,
            },
            (success: boolean) => {
              if (!success) {
                console.error('Failed to connect send transport');
                return;
              }
              console.log('Send transport connected successfully');
            }
          );
          callback();
        });

        transport.on('produce', async ({ kind, rtpParameters }, callback) => {
          console.log(`Producing track of kind: ${kind}`);
          socket.emit(
            'produce',
            {
              transportId: transport.id,
              kind,
              rtpParameters,
            },
            ({ id }: { id: string }) => {
              console.log(`Produced track with ID: ${id}`);
              callback({ id });

              if (kind === 'video') {
                console.log('Local media published, consuming peers in room with peerId:', peerIdentifier);
                // Use the passed parameter, not state
                socket.emit('consumePeersInRoom', { roomId, peerId: peerIdentifier });
              }
            }
          );
        });

        transport.on('connectionstatechange', async (state) => {
          console.log('Send transport connection state:', state);
        });

        try {
          await captureMedia(transport, stream);
        } catch (error) {
          console.error('Error capturing media:', error);
        }
      } else {
        console.log('Send transport already exists, skipping creation');
        // Use the passed parameter, not state
        socket.emit('consumePeersInRoom', { roomId, peerId: peerIdentifier });
      }
    });

    socket.emit('createTransport', { direction: 'send' });
  }, [socket, roomId]);

  const captureMedia = async (transport: mediasoupClient.types.Transport, stream: MediaStream) => {
    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        console.warn('No video track found in stream');
        return;
      }
      
      if (videoTrack.readyState === 'ended') {
        console.error('Video track is already ended');
        return;
      }

      console.log(`Producing video track with preferred codec: ${preferredCodec}`);
      
      // Configure encodings for different bandwidth scenarios
      const encodings = [
        { maxBitrate: 300000, scaleResolutionDownBy: 4 },
        { maxBitrate: 900000, scaleResolutionDownBy: 2 },
        { maxBitrate: 1500000, scaleResolutionDownBy: 1 }
      ];
      
      try {
        // Find the requested codec in device capabilities
        let codec = undefined;
        if (preferredCodec) {
          codec = deviceRef.current?.rtpCapabilities.codecs?.find(
            c => c.mimeType.toLowerCase() === `video/${preferredCodec}`
          );
          console.log('Found matching codec:', codec);
        }
        
        if (codec) {
          // Create a codec object with the required RtpCodecCapability properties
          const minimalCodec = {
            mimeType: codec.mimeType,
            kind: codec.kind,
            clockRate: codec.clockRate
          };
          
          console.log('Using minimal codec configuration:', minimalCodec);
          await transport.produce({
            track: videoTrack,
            encodings,
            codec: minimalCodec
          });
        } else {
          console.warn(`Using default codec as ${preferredCodec} not available or selected`);
          await transport.produce({ track: videoTrack, encodings });
        }
      } catch (codecError) {
        console.warn('Error using preferred codec, falling back to default:', codecError);
        
        // Check if track is still valid before attempting to produce again
        if (videoTrack.readyState === 'live') {
          // If codec selection fails, fall back to default with no codec specification
          await transport.produce({ 
            track: videoTrack,
            encodings: [{ maxBitrate: 1000000 }] // Simplified encoding
          });
        } else {
          console.error('Track became unavailable after codec error');
          throw new Error('Video track ended during codec negotiation');
        }
      }
    } catch (error) {
      console.error('Error capturing media:', error);
      throw error;
    }
  };

  const createRecvTransport = useCallback(async (data: { producerId: string; kind: 'audio' | 'video'; rtpParameters: any; peerId: string }) => {
    if (!socket || !deviceRef.current) return;
    
    console.log('Creating receive transport...');

    // Remove any existing handlers for these events
    socket.off('transportCreated');
    socket.off('readyToConsume');

    socket.once('transportCreated', async (options: any) => {
      console.log('Receive transport options received:', options);
      
      // Check if turnServers are properly configured
      if (!options.turnServers || !options.turnServers.length) {
        console.error('[ICE] No TURN servers provided by the server!');
      } else {
        logIceServers(options.turnServers);
      }
      
      // Properly extract and use TURN servers from the options
      const transportOptions = {
        id: options.id,
        iceParameters: options.iceParameters,
        iceCandidates: options.iceCandidates,
        dtlsParameters: options.dtlsParameters,
        iceServers: options.turnServers,
        // Add these configurations to encourage TURN usage
        iceTransportPolicy: 'relay' as RTCIceTransportPolicy, // Force using relay candidates only
        additionalIceParameters: {
          iceLite: false, // Ensure full ICE implementation
          iceControlling: true // Try to take control of ICE negotiation
        }
      };
      
      console.log('Creating receive transport with TURN servers:', options.turnServers);
      const transport = deviceRef.current!.createRecvTransport(transportOptions);

      // Access the internal PeerConnection used by mediasoup-client
      const handler = transport.handler as any;
      if (handler && handler.pc) {
        // This will initialize and start monitoring
        const monitorInterval = monitorPeerConnection(handler.pc, `Receive Transport (${data.peerId})`);
        
        // Clean up the monitoring when the transport closes
        transport.on('connectionstatechange', (state) => {
          if (state === 'closed') {
            clearInterval(monitorInterval);
            // Remove stats when transport closes
            if (connectionStatsRef.current[`Receive Transport (${data.peerId})`]) {
              delete connectionStatsRef.current[`Receive Transport (${data.peerId})`];
              setConnectionStats({...connectionStatsRef.current});
            }
          }
        });
      }
      
      transport.on('connect', async ({ dtlsParameters }, callback) => {
        console.log('Recv transport connecting...');
        socket.emit(
          'connectTransport',
          {
            transportId: transport.id,
            dtlsParameters,
          },
          (success: boolean) => {
            if (!success) {
              console.error('Failed to connect receive transport');
              return;
            }
            console.log('Receive transport connected successfully');
          }
        );
        callback();
      });

      transport.on('connectionstatechange', async (state) => {
        console.log(`Recv transport connection state for peer ${data.peerId}:`, state);

        // Handle disconnection states
        if (state === 'closed' || state === 'failed' || state === 'disconnected') {
          console.log(`Transport for peer ${data.peerId} is ${state}, removing from UI`);
          removePeerFromUI(data.peerId);
        }
      });

      socket.emit('consume', {
        producerId: data.producerId,
        transportId: transport.id,
        rtpCapabilities: deviceRef.current!.rtpCapabilities
      });

      // Use once instead of on to prevent multiple handlers
      socket.once('readyToConsume', async (rtpCapabilities: mediasoupClient.types.RtpParameters) => {
        try {
          const consumer = await transport.consume({
            id: transport.id,
            producerId: data.producerId,
            kind: data.kind,
            rtpParameters: rtpCapabilities,
          });
          console.log('Consumer created:', consumer);

          // Set up consumer close handler
          consumer.on('transportclose', () => {
            console.log(`Consumer transport closed for peer ${data.peerId}`);
            removePeerFromUI(data.peerId);
          });

          let stream = peerStreams.current.get(data.peerId);
          if (!stream) {
            stream = new MediaStream();
            peerStreams.current.set(data.peerId, stream);
            console.log('New MediaStream created for peer:', data.peerId);
          }
          stream.addTrack(consumer.track);
          console.log('Track added to MediaStream for peer:', data.peerId);

          setRemotePeers((prev) => {
            const exists = prev.find((p) => p.peerId === data.peerId);
            if (exists) {
              console.log('Updating existing peer stream:', data.peerId);
              return prev.map((p) => (p.peerId === data.peerId ? { ...p, stream } : p));
            } else {
              console.log('Adding new peer stream:', data.peerId);
              return [...prev, { peerId: data.peerId, stream }];
            }
          });
        } catch (error) {
          console.error('Error consuming stream:', error);
        }
      });
    });

    socket.emit('createTransport', { direction: 'recv' });
  }, [socket]);

  const removePeerFromUI = useCallback((peerId: string) => {
    console.log(`Removing peer ${peerId} from UI`);

    // Remove from state
    setRemotePeers(prevPeers => prevPeers.filter(p => p.peerId !== peerId));

    // Clean up stored stream
    const stream = peerStreams.current.get(peerId);
    if (stream) {
      // Stop all tracks in the stream
      stream.getTracks().forEach(track => track.stop());
      peerStreams.current.delete(peerId);
    }

    // If this was the active video, reset active video
    setActiveVideoId(prev => prev === peerId ? 'local' : prev);
  }, []);

  // Update the joinRoom function to accept an explicit roomId parameter
  const joinRoom = useCallback(async (localStream: MediaStream, explicitRoomId?: string) => {
    if (!socket) {
      console.error('Socket connection not established');
      return;
    }
    
    // Use the provided room ID or fall back to the state
    const roomToJoin = explicitRoomId || roomId;
    
    console.log('Attempting to join room:', roomToJoin);
    if (!roomToJoin) {
      alert('Room ID is required to join a room.');
      return;
    }

    try {
      // Generate peer ID as a local variable
      const generatedPeerId = `peer-${Math.random().toString(36).substring(2, 15)}`;
      setPeerId(generatedPeerId);
      console.log('Generated Peer ID:', generatedPeerId);

      // If using an explicit room ID, make sure to update the state
      if (explicitRoomId && explicitRoomId !== roomId) {
        setRoomId(explicitRoomId);
      }

      // Use the local variable instead of state
      socket.emit('joinRoom', { roomId: roomToJoin, peerId: generatedPeerId });
      console.log('Emitted joinRoom event with roomId and peerId:', generatedPeerId);
      setIsJoined(true);

      // Handle socket events
      socket.on('joinedRoom', async (rtpCapabilities: any) => {
        console.log('Received router RTP capabilities:', rtpCapabilities);
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities }).then(async () => {
          deviceRef.current = device;
          console.log('Mediasoup device loaded.', device);

          // Pass the generated peerId to createSendTransport
          await createSendTransport(localStream, generatedPeerId);
        });
      });

      socket.on('newConsumer', async (data: { producerId: string; kind: "audio" | "video"; rtpParameters: any; peerId: string; }) => {
        console.log('Received new consumer event:', data);
        await createRecvTransport(data);
      });

      socket.on('newConsumers', async (data: { producers: { producerId: string; kind: 'audio' | 'video'; rtpParameters: any; peerId: string; }[] }) => {
        console.log('Received new consumers event:', data);

        // Process all producers in parallel
        const promises = data.producers.map(producer => {
          return new Promise(async (resolve) => {
            try {
              console.log(`Creating transport for producer ${producer.peerId}`);
              await createRecvTransport(producer);
              resolve(true);
            } catch (error) {
              console.error(`Error creating transport for producer ${producer.peerId}:`, error);
              resolve(false);
            }
          });
        });

        await Promise.all(promises);
        console.log('Finished processing all new consumers');
      });

      socket.on('producerClosed', (data: { peerId: string; }) => {
        console.log(`Producer closed for peer ${data.peerId}`);
        removePeerFromUI(data.peerId);
      });

      socket.on('peerDisconnected', (data: { peerId: string; }) => {
        console.log(`Peer disconnected: ${data.peerId}`);
        removePeerFromUI(data.peerId);
      });
    } catch (error) {
      console.error('Error joining room:', error);
    }
  }, [socket, roomId, createSendTransport, createRecvTransport, removePeerFromUI]);

  const leaveRoom = useCallback(() => {
    if (!socket || !isJoined || !roomId || !peerId) return;
    
    console.log('User initiated disconnect');
    
    // First notify the server we're leaving
    socket.emit('leaveRoom', { roomId, peerId });
    console.log('Emitted leaveRoom event');
    
    // Clean up
    cleanupRoomResources();
  }, [socket, roomId, peerId, isJoined]);

  const cleanupRoomResources = useCallback(() => {
    console.log('Cleaning up room resources');
    
    // Close all transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
      console.log('Closed send transport');
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
      console.log('Closed receive transport');
    }

    // Clean up all peer streams
    peerStreams.current.forEach((stream, peerId) => {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped track for peer ${peerId}:`, track.kind);
      });
    });
    peerStreams.current.clear();

    // Remove all socket event listeners
    if (socket) {
      socket.off('joinedRoom');
      socket.off('newConsumer');
      socket.off('newConsumers');
      socket.off('transportCreated');
      socket.off('readyToConsume');
      socket.off('producerClosed');
      socket.off('peerDisconnected');
      socket.off('leftRoom');
    }

    // Reset UI state
    setIsJoined(false);
    setRemotePeers([]);
    setActiveVideoId(null);
  }, [socket]);

  useEffect(() => {
    // Set the first remote peer as active when available
    if (remotePeers.length > 0 && !activeVideoId) {
      setActiveVideoId(remotePeers[0].peerId);
    }
  }, [remotePeers, activeVideoId]);

  // Add this near the top of your file, inside the useWebRTC hook

  // Enhance the monitorPeerConnection function
  const monitorPeerConnection = (pc: RTCPeerConnection, description: string) => {
    console.log(`[ICE][${isReactNative ? 'RN' : 'Web'}] Monitoring connection: ${description}`);

    // Initialize stats for this connection if they don't exist
    if (!connectionStatsRef.current[description]) {
      connectionStatsRef.current[description] = {
        connectionState: pc.iceConnectionState,
        candidates: { host: 0, srflx: 0, relay: 0 },
        dataFlow: {
          sendBitrate: 0,
          receiveBitrate: 0,
          totalBytesSent: 0,
          totalBytesReceived: 0,
          timestamp: Date.now()
        },
        tracks: {
          sending: [],
          receiving: []
        },
        platform: isReactNative ? 'react-native' : 'web'
      };
      // Initial update to trigger UI render
      setConnectionStats({...connectionStatsRef.current});
    }

    // Platform-specific ICE candidate handling
    if (!isReactNative) {
      // Web browser implementation
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          handleIceCandidate(event.candidate, description);
        }
      };
    } else {
      // React Native implementation
      pc.addEventListener('icecandidate', (event: any) => {
        if (event.candidate) {
          handleIceCandidate(event.candidate, description);
        }
      });
    }
    
    // Start interval for monitoring data flow - same for both platforms
    return monitorDataFlow(pc, description);
  };

  // Add a helper function for handling ICE candidates
  const handleIceCandidate = (candidate: RTCIceCandidate, description: string) => {
    const candidateType = candidate.type || 
      (candidate.candidate && candidate.candidate.includes('typ relay') ? 'relay' : 
       candidate.candidate && candidate.candidate.includes('typ srflx') ? 'srflx' : 'host');
    
    // Update candidate counter
    if (!connectionStatsRef.current[description].candidates[candidateType]) {
      connectionStatsRef.current[description].candidates[candidateType] = 0;
    }
    connectionStatsRef.current[description].candidates[candidateType]++;
    
    // Update UI
    setConnectionStats({...connectionStatsRef.current});
    
    // Log for debugging - make it work in both environments
    console.log(`[ICE][${isReactNative ? 'RN' : 'Web'}] ${description} candidate (${candidateType}): 
      protocol: ${candidate.protocol || 'unknown'}
      address: ${candidate.address || 'unknown'}
      port: ${candidate.port || 'unknown'}
      relayProtocol: ${(candidate as any).relayProtocol || 'none'}
      timestamp: ${new Date().toISOString()}
    `);
  };

  // Update monitorDataFlow to be platform-agnostic
  const monitorDataFlow = (pc: RTCPeerConnection, description: string) => {
    let lastBytesSent = 0;
    let lastBytesReceived = 0;
    let lastTimestamp = Date.now();
    
    // Update track info initially and when tracks change
    const updateTrackInfo = () => {
      if (!connectionStatsRef.current[description]) return;
      
      try {
        const senders = pc.getSenders ? pc.getSenders().map(sender => ({
          kind: sender.track?.kind || 'unknown',
          enabled: sender.track?.enabled || false,
          muted: sender.track?.muted || false
        })) : [];
        
        const receivers = pc.getReceivers ? pc.getReceivers().map(receiver => ({
          kind: receiver.track?.kind || 'unknown',
          enabled: receiver.track?.enabled || false,
          muted: receiver.track?.muted || false
        })) : [];
        
        connectionStatsRef.current[description].tracks = {
          sending: senders,
          receiving: receivers
        };
        
        setConnectionStats({...connectionStatsRef.current});
      } catch (e) {
        console.error('[Track] Error updating track info:', e);
      }
    };
    
    // Call initially and add track event listener in a platform-agnostic way
    updateTrackInfo();
    
    // Handle track events in a platform-agnostic way
    try {
      if (!isReactNative) {
        // Web browser implementation
        pc.addEventListener('track', updateTrackInfo);
      } else {
        // React Native implementation
        pc.ontrack = updateTrackInfo;
      }
    } catch (e) {
      console.warn('Error setting track listener:', e);
    }
    
    // Start interval for monitoring data flow
    const interval = setInterval(async () => {
      if (!pc || pc.connectionState === 'closed' || pc.iceConnectionState === 'closed') {
        clearInterval(interval);
        return;
      }
      
      try {
        // Use the platform-agnostic getStats method
        const stats = await WebRTCUtils.getStats(pc);
        let totalBytesSent = 0;
        let totalBytesReceived = 0;
        
        // Process stats in a platform-agnostic way
        stats.forEach(report => {
          if (report.type === 'outbound-rtp' && report.bytesSent) {
            totalBytesSent += report.bytesSent;
          }
          
          if (report.type === 'inbound-rtp' && report.bytesReceived) {
            totalBytesReceived += report.bytesReceived;
          }
        });
        
        // Calculate bitrates (same for both platforms)
        const now = Date.now();
        const duration = (now - lastTimestamp) / 1000;
        const sendBitrate = ((totalBytesSent - lastBytesSent) * 8 / duration) / 1000;
        const receiveBitrate = ((totalBytesReceived - lastBytesReceived) * 8 / duration) / 1000;
        
        // Update for next calculation
        lastBytesSent = totalBytesSent;
        lastBytesReceived = totalBytesReceived;
        lastTimestamp = now;
        
        // Update stats in the ref
        if (connectionStatsRef.current[description]) {
          connectionStatsRef.current[description].dataFlow = {
            sendBitrate,
            receiveBitrate,
            totalBytesSent,
            totalBytesReceived,
            timestamp: now
          };
          
          // Only update state if there's actual data flowing to minimize renders
          if (sendBitrate > 0 || receiveBitrate > 0 || 
              connectionStatsRef.current[description].dataFlow.totalBytesSent !== totalBytesSent ||
              connectionStatsRef.current[description].dataFlow.totalBytesReceived !== totalBytesReceived) {
            setConnectionStats({...connectionStatsRef.current});
          }
        }
      } catch (e) {
        console.error('[DATA] Error monitoring data flow:', e);
      }
    }, 2000);
    
    return interval;
  };

  // Check browser/React Native compatibility in a platform-agnostic way
  const checkMediaSupport = useCallback(() => {
    if (isReactNative) {
      // For React Native, check if we have loaded the WebRTC module
      if (!ReactNativeWebRTC) {
        return { 
          supported: false, 
          reason: "React Native WebRTC module not loaded. Make sure 'react-native-webrtc' is installed and linked properly."
        };
      }
      return { supported: true };
    } else {
      // For web browsers
      if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return {
          supported: false,
          reason: "Your browser does not support media devices access. Please use a modern browser like Chrome, Firefox, or Edge."
        };
      }
      return { supported: true };
    }
  }, []);

  // Add the platform check to the returned object
  return {
    roomId,
    setRoomId,
    peerId,
    isJoined,
    remotePeers,
    activeVideoId,
    setActiveVideoId,
    joinRoom,
    leaveRoom,
    cleanupRoomResources,
    preferredCodec,
    setPreferredCodec,
    connectionStats,
    isReactNative, // Export this so components can adapt their UI
    checkMediaSupport // Export the platform check function
  };
};
