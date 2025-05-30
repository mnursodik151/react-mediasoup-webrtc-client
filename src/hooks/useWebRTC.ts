import { useState, useRef, useCallback, useEffect } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { Socket } from 'socket.io-client';

export type PeerStream = {
  peerId: string;
  stream: MediaStream;
};

export const useWebRTC = (socket: Socket | null) => {
  // Add codec configuration
  const [preferredCodec, setPreferredCodec] = useState<'vp8' | 'vp9' | 'h264' | 'h265'>('h264');
  
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
        
        console.log('Creating send transport with TURN servers:', options.turnServers);
        const transport = deviceRef.current.createSendTransport(transportOptions);
        sendTransportRef.current = transport;

        // Access the internal PeerConnection used by mediasoup-client
        const handler = transport.handler as any;
        if (handler && handler.pc) {
          monitorPeerConnection(handler.pc, 'Send Transport');
          // Add this line:
          const monitorInterval = monitorDataFlow(handler.pc, 'Send Transport');
          
          // Clean up the monitoring when the transport closes
          const existingConnectionHandler = transport.on('connectionstatechange', async (state) => {
            console.log('Send transport connection state:', state);
            if (state === 'closed') {
              clearInterval(monitorInterval);
            }
          });
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
        monitorPeerConnection(handler.pc, `Receive Transport (${data.peerId})`);
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
    console.log(`[ICE] Monitoring connection: ${description}`);

    // Log all ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateType = event.candidate.type || 'unknown';
        candidateCounter[candidateType] = (candidateCounter[candidateType] || 0) + 1;
        
        console.log(`[ICE] ${description} candidate ${candidateCounter[candidateType]} (${candidateType}): 
          protocol: ${event.candidate.protocol}
          address: ${event.candidate.address}
          port: ${event.candidate.port}
          relayProtocol: ${(event.candidate as any).relayProtocol || 'none'}
          timestamp: ${new Date().toISOString()}
        `);
      }
    };
    
    // Enhanced state tracking with timestamps
    pc.oniceconnectionstatechange = () => {
      console.log(`[ICE] ${description} connection state changed: ${pc.iceConnectionState} at ${new Date().toISOString()}`);
      
      if (pc.iceConnectionState === 'checking') {
        console.log(`[ICE] Checking ICE candidates (host: ${candidateCounter.host || 0}, srflx: ${candidateCounter.srflx || 0}, relay: ${candidateCounter.relay || 0})`);
      } else if (pc.iceConnectionState === 'failed') {
        // Log ICE failure details and add advanced diagnostics
        console.error(`[ICE] Connection failed with ${candidateCounter.relay || 0} relay candidates!`);
        
        // Force ICE restart on failure (if supported)
        try {
          pc.restartIce?.();
          console.log('[ICE] Attempted ICE restart');
        } catch (e) {
          console.warn('[ICE] ICE restart not supported or failed', e);
        }
        
        // Log all available stats on failure
        pc.getStats().then(stats => {
          console.log('[ICE] Connection stats at failure:', Array.from(stats.values()));
        });
      }
    };
  };

  // Helper to get the selected candidate pair (works in Chrome)
  const getSelectedCandidatePair = async (pc: RTCPeerConnection) => {
    if (!pc.getStats) return null;
    
    try {
      const stats = await pc.getStats();
      let selectedPair: RTCIceCandidatePairStats | null = null;
      
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.selected) {
          selectedPair = report as RTCIceCandidatePairStats;
        }
      });
      
      if (selectedPair) {
        // Create a properly typed non-null reference
        const nonNullPair = selectedPair as RTCIceCandidatePairStats & {
          localCandidateId: string;
          remoteCandidateId: string;
        };
        let localCandidate = null;
        let remoteCandidate = null;
        
        stats.forEach(report => {
          if (report.id === nonNullPair.localCandidateId) {
            localCandidate = report;
          }
          if (report.id === nonNullPair.remoteCandidateId) {
            remoteCandidate = report;
          }
        });
        
        return {
          local: localCandidate,
          remote: remoteCandidate,
          pair: selectedPair
        };
      }
      return null;
    } catch (e) {
      console.error('[ICE] Error getting stats:', e);
      return null;
    }
  };

  // Function to log TURN servers being used
  const logIceServers = (servers: RTCIceServer[]) => {
    console.log('[ICE] Configured ICE servers:');
    if (!servers || !servers.length) {
      console.warn('[ICE] No ICE servers provided!');
      return;
    }
    
    servers.forEach((server, i) => {
      console.log(`[ICE] Server ${i+1}:`, {
        urls: server.urls,
        username: server.username ? '✓' : '✗',
        credential: server.credential ? '✓' : '✗'
      });
    });
  };

  // Add this code to test your TURN server directly
  // filepath: d:\Projects\io3-vsion-backends\sfu-web-client\src\hooks\useWebRTC.ts

  // Add this function to your hook
  const testTurnServer = useCallback((turnServer: RTCIceServer) => {
    console.log('[ICE] Testing TURN server:', turnServer);
    
    const pc1 = new RTCPeerConnection({ iceServers: [turnServer] });
    const pc2 = new RTCPeerConnection({ iceServers: [turnServer] });
    
    // Monitor both connections
    monitorPeerConnection(pc1, 'TEST PC1');
    monitorPeerConnection(pc2, 'TEST PC2');
    
    pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate);
    pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate);
    
    // Create a data channel to trigger ICE connection
    const dc = pc1.createDataChannel('test');
    dc.onopen = () => console.log('[ICE] TEST CONNECTION SUCCEEDED - TURN server works!');
    
    // Create offer/answer to establish connection
    pc1.createOffer()
      .then(offer => pc1.setLocalDescription(offer))
      .then(() => pc2.setRemoteDescription(pc1.localDescription!))
      .then(() => pc2.createAnswer())
      .then(answer => pc2.setLocalDescription(answer))
      .then(() => pc1.setRemoteDescription(pc2.localDescription!))
      .catch(err => console.error('[ICE] Test failed:', err));
    
    // Cleanup after 15 seconds
    setTimeout(() => {
      pc1.close();
      pc2.close();
    }, 15000);
  }, []);

  // Add this function to test TURN servers when needed
  const setupTurnServerTest = useCallback(() => {
    if (!socket) return;
    
    socket.once('transportCreated', async (options: any) => {
      if (options.turnServers && options.turnServers.length) {
        // Test each TURN server independently
        options.turnServers.forEach(testTurnServer);
      }
    });
  }, [socket, testTurnServer]);
  
  // You can call setupTurnServerTest() within joinRoom if you want to test TURN servers

  // Add this function to test basic TURN server connectivity
  const checkTurnServerAccess = async (turnServer: RTCIceServer): Promise<boolean> => {
    try {
      // Simple fetch test to see if server is reachable
      // Extract server domain from URLs
      const urls = Array.isArray(turnServer.urls) ? turnServer.urls[0] : turnServer.urls;
      const serverUrl = urls.replace(/^(turn|stun)s?:\/\//, 'https://');
      const domainOnly = serverUrl.split(':')[0];
      
      console.log(`[ICE] Testing basic connectivity to TURN server domain: ${domainOnly}`);
      
      // Just perform a HEAD request to see if server is online
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`https://${domainOnly}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal
      }).catch(() => null);
      
      clearTimeout(timeoutId);
      return !!response;
    } catch (err) {
      console.warn('[ICE] TURN server domain connection test failed:', err);
      return false;
    }
  };

  // Add this function to monitor data flow
  const monitorDataFlow = (pc: RTCPeerConnection, description: string) => {
    let lastBytesSent = 0;
    let lastBytesReceived = 0;
    let lastTimestamp = Date.now();
    
    // Initialize stats for this connection
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
          sending: [] as any[],
          receiving: [] as any[]
        }
      };
    }
    
    // Update connection state
    pc.oniceconnectionstatechange = () => {
      console.log(`[ICE] ${description} connection state changed: ${pc.iceConnectionState}`);
      
      if (!connectionStatsRef.current[description]) return;
      
      connectionStatsRef.current[description].connectionState = pc.iceConnectionState;
      setConnectionStats({...connectionStatsRef.current});
      
      // Rest of your existing code...
    };
    
    // Update candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateType = event.candidate.type || 'unknown';
        
        if (!connectionStatsRef.current[description]) return;
        
        if (!connectionStatsRef.current[description].candidates[candidateType]) {
          connectionStatsRef.current[description].candidates[candidateType] = 0;
        }
        
        connectionStatsRef.current[description].candidates[candidateType]++;
        setConnectionStats({...connectionStatsRef.current});
        
        // Rest of your existing code...
      }
    };
    
    // Update track info initially
    const updateTrackInfo = () => {
      const senders = pc.getSenders().map(sender => ({
        kind: sender.track?.kind || 'unknown',
        enabled: sender.track?.enabled || false,
        muted: sender.track?.muted || false
      }));
      
      const receivers = pc.getReceivers().map(receiver => ({
        kind: receiver.track?.kind || 'unknown',
        enabled: receiver.track?.enabled || false,
        muted: receiver.track?.muted || false
      }));
      
      connectionStatsRef.current[description].tracks = {
        sending: senders,
        receiving: receivers
      };
      
      setConnectionStats({...connectionStatsRef.current});
    };
    
    // Call initially and on track events
    updateTrackInfo();
    pc.ontrack = () => updateTrackInfo();
    
    const interval = setInterval(async () => {
      try {
        const stats = await pc.getStats();
        let totalBytesSent = 0;
        let totalBytesReceived = 0;
        
        stats.forEach(report => {
          // Check for outbound-rtp (sending data)
          if (report.type === 'outbound-rtp' && report.bytesSent) {
            totalBytesSent += report.bytesSent;
          }
          
          // Check for inbound-rtp (receiving data)
          if (report.type === 'inbound-rtp' && report.bytesReceived) {
            totalBytesReceived += report.bytesReceived;
          }
        });
        
        // Calculate bitrates
        const now = Date.now();
        const duration = (now - lastTimestamp) / 1000; // seconds
        const sendBitrate = ((totalBytesSent - lastBytesSent) * 8 / duration) / 1000; // kbps
        const receiveBitrate = ((totalBytesReceived - lastBytesReceived) * 8 / duration) / 1000; // kbps
        
        // Update for next calculation
        lastBytesSent = totalBytesSent;
        lastBytesReceived = totalBytesReceived;
        lastTimestamp = now;
        
        // Update stats ref
        if (connectionStatsRef.current[description]) {
          connectionStatsRef.current[description].dataFlow = {
            sendBitrate,
            receiveBitrate,
            totalBytesSent,
            totalBytesReceived,
            timestamp: now
          };
          
          // Update state to trigger re-render
          setConnectionStats({...connectionStatsRef.current});
        }
        
        if (sendBitrate > 0 || receiveBitrate > 0) {
          console.log(`[DATA] ${description} - Sending: ${sendBitrate.toFixed(2)} kbps, Receiving: ${receiveBitrate.toFixed(2)} kbps`);
          console.log(`[DATA] ${description} - Total sent: ${(totalBytesSent/1024).toFixed(2)} KB, Total received: ${(totalBytesReceived/1024).toFixed(2)} KB`);
        } else {
          console.warn(`[DATA] ${description} - No data flowing!`);
        }
      } catch (e) {
        console.error('[DATA] Error monitoring data flow:', e);
      }
    }, 3000); // Check every 3 seconds
    
    return interval;
  };

  const monitorTrackStatus = (pc: RTCPeerConnection, description: string) => {
    pc.getSenders().forEach(sender => {
      if (sender.track) {
        console.log(`[TRACK] ${description} Sending track: ${sender.track.kind}, enabled: ${sender.track.enabled}, muted: ${sender.track.muted}`);
        
        // Monitor track state changes
        sender.track.onended = () => console.log(`[TRACK] ${description} Sending ${sender.track!.kind} track ended`);
        sender.track.onmute = () => console.log(`[TRACK] ${description} Sending ${sender.track!.kind} track muted`);
        sender.track.onunmute = () => console.log(`[TRACK] ${description} Sending ${sender.track!.kind} track unmuted`);
      }
    });
    
    pc.getReceivers().forEach(receiver => {
      if (receiver.track) {
        console.log(`[TRACK] ${description} Receiving track: ${receiver.track.kind}, enabled: ${receiver.track.enabled}, muted: ${receiver.track.muted}`);
        
        // Monitor track state changes
        receiver.track.onended = () => console.log(`[TRACK] ${description} Receiving ${receiver.track!.kind} track ended`);
        receiver.track.onmute = () => console.log(`[TRACK] ${description} Receiving ${receiver.track!.kind} track muted`);
        receiver.track.onunmute = () => console.log(`[TRACK] ${description} Receiving ${receiver.track!.kind} track unmuted`);
      }
    });
  };

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
    connectionStats
  };
};
