import { useState, useRef, useCallback, useEffect } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { Socket } from 'socket.io-client';

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
  // Separate refs for audio and video transports
  const sendVideoTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const sendAudioTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const peerStreams = useRef<Map<string, MediaStream>>(new Map());
  const candidateCounter = useRef<Record<string, number>>({}).current;
  // Track if consumePeersInRoom has already been emitted
  const consumePeersEmittedRef = useRef<boolean>(false);

  // Add these at the beginning of the hook function
  const connectionStatsRef = useRef<Record<string, any>>({});
  const [connectionStats, setConnectionStats] = useState<Record<string, any>>({});
  
  // Track mapping to associate track IDs with peer IDs
  const trackToPeerMap = useRef<Map<string, string>>(new Map());

  // Create a send transport for a specific media type (audio or video)
  const createSendTransport = useCallback(async (
    stream: MediaStream, 
    peerIdentifier: string, 
    mediaType: 'audio' | 'video'
  ) => {
    if (!socket) return;
    
    console.log(`Creating ${mediaType} send transport...`);

    // Create a unique event handler for this media type
    const transportCreatedEventName = `transportCreated_send_${mediaType}`;
    
    // Remove any existing handlers for this event before adding new ones
    socket.off(transportCreatedEventName);

    // Use once instead of on to ensure the handler only executes once
    console.log(`listening for ${mediaType} transport creation event:`, transportCreatedEventName);
    socket.once(transportCreatedEventName, async (options: any) => {
      console.log(`${mediaType} transport options received:`, options);

      // Check if turnServers are properly configured
      if (!options.turnServers || !options.turnServers.length) {
        console.error('[ICE] No TURN servers provided by the server!');
      } else {
        logIceServers(options.turnServers);
      }

      // Get the correct transport ref based on media type
      const transportRef = mediaType === 'video' ? sendVideoTransportRef : sendAudioTransportRef;

      // Only create transport if it doesn't exist
      if (!transportRef.current && deviceRef.current) {
        // Properly extract and use TURN servers from the options
        const transportOptions = {
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          iceServers: options.turnServers,
          // Add these configurations to encourage TURN usage
          additionalIceParameters: {
            iceLite: false, // Ensure full ICE implementation
            iceControlling: true, // Try to take control of ICE negotiation
            iceTransportPolicy: 'relay' as RTCIceTransportPolicy, // Force using relay candidates only
          }
        };
        
        console.log(`Creating ${mediaType} send transport with TURN servers:`, options.turnServers);
        console.log('Transport options:', transportOptions);
        const transport = deviceRef.current.createSendTransport(transportOptions);
        transportRef.current = transport;

        // Access the internal PeerConnection used by mediasoup-client
        const handler = transport.handler as any;
        if (handler && handler.pc) {
          // This will initialize and start monitoring
          const monitorInterval = monitorPeerConnection(handler.pc, `Send ${mediaType.toUpperCase()} Transport`);
          
          // Clean up the monitoring when the transport closes
          transport.on('connectionstatechange', (state) => {
            if (state === 'closed') {
              clearInterval(monitorInterval);
              // Remove stats when transport closes
              if (connectionStatsRef.current[`Send ${mediaType.toUpperCase()} Transport`]) {
                delete connectionStatsRef.current[`Send ${mediaType.toUpperCase()} Transport`];
                setConnectionStats({...connectionStatsRef.current});
              }
            }
          });
        }
        
        transport.on('connect', async ({ dtlsParameters }, callback) => {
          console.log(`${mediaType} transport connecting...`);
          console.log('DTLS parameters:', dtlsParameters);
          // Emit the connectTransport event with the transport ID and DTLS parameters
          socket.emit(
            'connectTransport',
            {
              transportId: transport.id,
              dtlsParameters,
              mediaType, // Include media type in the event
            },
            (success: boolean) => {
              if (!success) {
                console.error(`Failed to connect ${mediaType} send transport`);
                return;
              }
              console.log(`${mediaType} send transport connected successfully`);
            }
          );
          callback();
        });

        transport.on('produce', async ({ kind, rtpParameters }, callback) => {
          console.log(`Producing ${kind} track via ${mediaType} transport`);
          socket.emit(
            'produce',
            {
              transportId: transport.id,
              kind,
              rtpParameters,
              mediaType, // Include the media type in the event
            },
            ({ id }: { id: string }) => {
              console.log(`Produced ${kind} track with ID: ${id}`);
              callback({ id });

              // Check if all transports are ready
                if (sendVideoTransportRef.current && sendAudioTransportRef.current) {
                // Check if we've already emitted the consumePeersInRoom event
                if (!consumePeersEmittedRef.current) {
                  console.log('Both transports created, consuming peers in room with peerId:', peerIdentifier);
                  // Use the passed parameter, not state
                  socket.emit('consumePeersInRoom', { roomId, peerId: peerIdentifier });
                  // Mark as emitted
                  consumePeersEmittedRef.current = true;
                } else {
                  console.log('Already emitted consumePeersInRoom, skipping duplicate event');
                }
                }
            }
          );
        });

        transport.on('connectionstatechange', async (state) => {
          console.log(`${mediaType} send transport connection state:`, state);
        });

        try {
          // Only capture the specific media type's track
          await captureMedia(transport, stream, mediaType);
        } catch (error) {
          console.error(`Error capturing ${mediaType} media:`, error);
        }
      } else {
        console.log(`${mediaType} send transport already exists, skipping creation`);
        
        // Check if all transports are ready
        if (sendVideoTransportRef.current && sendAudioTransportRef.current) {
          // Use the passed parameter, not state
          socket.emit('consumePeersInRoom', { roomId, peerId: peerIdentifier });
        }
      }
    });

    socket.emit('createTransport', { 
      direction: 'send',
      kind: mediaType, // Include the media type in the event
      peerId: peerIdentifier,
    });
  }, [socket, roomId]);

  // Modified to handle specific media types
  const captureMedia = async (
    transport: mediasoupClient.types.Transport, 
    stream: MediaStream,
    mediaType: 'audio' | 'video'
  ) => {
    try {
      // Get track based on media type
      const track = mediaType === 'video' 
        ? stream.getVideoTracks()[0] 
        : stream.getAudioTracks()[0];
      
      if (!track) {
        console.warn(`No ${mediaType} track found in stream`);
        return;
      }
      
      if (track.readyState === 'ended') {
        console.error(`${mediaType} track is already ended`);
        return;
      }

      console.log(`Producing ${mediaType} track`);
      
      // Configure options based on media type
      if (mediaType === 'video') {
        // Configure encodings for video
        const encodings = [
          { maxBitrate: 300000, scaleResolutionDownBy: 4 }
        ];
        
        try {
          // Find the requested codec in device capabilities
          let codec = undefined;
          if (preferredCodec) {
            codec = deviceRef.current?.rtpCapabilities.codecs?.find(
              c => c.mimeType.toLowerCase() === `video/${preferredCodec}`
            );
            console.log('Found matching codec for video:', codec);
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
              track,
              encodings,
              codec: minimalCodec
            });
          } else {
            console.warn(`Using default codec as ${preferredCodec} not available or selected`);
            await transport.produce({ track, encodings });
          }
        } catch (codecError) {
          console.warn('Error using preferred codec, falling back to default:', codecError);
          
          // Check if track is still valid before attempting to produce again
          if (track.readyState === 'live') {
            // If codec selection fails, fall back to default with no codec specification
            await transport.produce({ 
              track,
              encodings: [{ maxBitrate: 1000000 }] // Simplified encoding
            });
          } else {
            console.error('Track became unavailable after codec error');
            throw new Error('Video track ended during codec negotiation');
          }
        }
      } else {
        // For audio, simpler config without codec preferences
        await transport.produce({ 
          track,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
          }
        });
      }
    } catch (error) {
      console.error(`Error capturing ${mediaType} media:`, error);
      throw error;
    }
  };

  // Helper to check if a peer has any remaining tracks and remove if not
  const checkAndRemovePeerIfNeeded = useCallback((peerId: string) => {
    // Check if any tracks are still associated with this peer
    let peerHasTracks = false;
    trackToPeerMap.current.forEach((pId, trackId) => {
      if (pId === peerId) {
        peerHasTracks = true;
      }
    });

    if (!peerHasTracks) {
      removePeerFromUI(peerId);
    }
  }, []);

  const removePeerFromUI = useCallback((peerId: string) => {
    console.log(`Removing peer ${peerId} from UI`);

    // Remove from state
    setRemotePeers(prevPeers => prevPeers.filter(p => p.peerId !== peerId));

    // Clean up stored stream
    const stream = peerStreams.current.get(peerId);
    if (stream) {
      // Stop all tracks in the stream
      stream.getTracks().forEach(track => {
        track.stop();
        // Also clear the track-peer mapping
        trackToPeerMap.current.delete(track.id);
      });
      peerStreams.current.delete(peerId);
    }

    // If this was the active video, reset active video
    setActiveVideoId(prev => prev === peerId ? 'local' : prev);
  }, []);

  // Modified to handle multiple tracks from the same peer with improved error handling
  const createRecvTransport = useCallback(async (data: { 
    producerId: string; 
    kind: 'audio' | 'video'; 
    rtpParameters: any; 
    peerId: string;
    trackId?: string;
  }) => {
    if (!socket || !deviceRef.current) return;
    
    console.log(`Creating receive transport for ${data.kind} from peer ${data.peerId}...`);

    // Create a unique event name for this specific consumer to avoid conflicts
    const transportEventName = `transportCreated_recv_${data.kind}}`;
    console.log(`Using unique transport event name: ${transportEventName}`);
    
    // Remove any existing handlers for these events
    socket.off(transportEventName);
    
    // Use a unique consume ready event to avoid conflicts
    const consumeReadyEventName = `readyToConsume_${data.peerId}_${data.producerId}`;
    console.log(`Listening unique consume ready event name: ${consumeReadyEventName}`);
    socket.off(consumeReadyEventName);

    socket.once(transportEventName, async (options: any) => {
      console.log(`Received transport options for ${data.kind} from ${data.peerId}:`, options);
      
      // Check if turnServers are properly configured
      if (!options.turnServers || !options.turnServers.length) {
        console.error('[ICE] No TURN servers provided by the server!');
      } else {
        logIceServers(options.turnServers);
      }
      
      try {
        // Properly extract and use TURN servers from the options
        const transportOptions = {
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          iceServers: options.turnServers,
          // Add these configurations to encourage TURN usage
          iceTransportPolicy: 'relay' as RTCIceTransportPolicy,
          additionalIceParameters: {
            iceLite: false,
            iceControlling: true
          }
        };
        
        console.log(`Creating receive transport for ${data.kind} with TURN servers:`, options.turnServers);
        const transport = deviceRef.current!.createRecvTransport(transportOptions);

        // Access the internal PeerConnection used by mediasoup-client
        const handler = transport.handler as any;
        if (handler && handler.pc) {
          // Monitor connection
          const monitorInterval = monitorPeerConnection(
            handler.pc, 
            `Receive Transport (${data.peerId}-${data.kind})`
          );
          
          // Clean up monitoring on close
          transport.on('connectionstatechange', (state) => {
            if (state === 'closed' || state === 'failed') {
              clearInterval(monitorInterval);
              if (connectionStatsRef.current[`Receive Transport (${data.peerId}-${data.kind})`]) {
                delete connectionStatsRef.current[`Receive Transport (${data.peerId}-${data.kind})`];
                setConnectionStats({...connectionStatsRef.current});
              }
            }
          });
        }
        
        transport.on('connect', async ({ dtlsParameters }, callback) => {
          console.log(`Recv transport for ${data.kind} connecting...`);
          socket.emit(
            'connectTransport',
            {
              transportId: transport.id,
              dtlsParameters,
              kind: data.kind,
              peerId: data.peerId // Include peer ID for better tracking
            },
            (success: boolean) => {
              if (!success) {
                console.error(`Failed to connect receive transport for ${data.kind}`);
                return;
              }
              console.log(`Receive transport for ${data.kind} connected successfully`);
            }
          );
          callback();
        });

        transport.on('connectionstatechange', async (state) => {
          console.log(`Recv transport connection state for peer ${data.peerId} ${data.kind}:`, state);

          if (state === 'closed' || state === 'failed' || state === 'disconnected') {
            console.log(`Transport for peer ${data.peerId} ${data.kind} is ${state}`);
            // Only remove peer if all transports are disconnected
            checkAndRemovePeerIfNeeded(data.peerId);
          }
        });

        // // Add request modifiers for audio to fix SSRC issues
        // const additionalOptions = data.kind === 'audio' ? {
        //   codecOptions: {
        //     opusStereo: true,
        //     opusDtx: true,
        //     opusFec: true, 
        //     opusPtime: 20,
        //   },
        //   // For audio, specify explicitly that this is a different stream
        //   streamId: `${data.peerId}_audio_${Date.now()}`,
        //   trackId: `${data.peerId}_audiotrack_${Date.now()}`
        // } : {};

        socket.emit('consume', {
          producerId: data.producerId,
          transportId: transport.id,
          rtpCapabilities: deviceRef.current!.rtpCapabilities,
          kind: data.kind,
          // ...additionalOptions // Add the audio-specific options
        });

        // Use a unique event name to avoid conflicts between different consumptions
        socket.once(consumeReadyEventName, async (rtpCapabilities: mediasoupClient.types.RtpParameters) => {
          try {
            console.log(`Ready to consume ${data.kind} from ${data.peerId} with parameters:`, rtpCapabilities);
            
            // Fix the SSRC conflict issue by ensuring unique track IDs and SSRCs for audio
            if (data.kind === 'audio' && rtpCapabilities?.encodings && Array.isArray(rtpCapabilities.encodings) && rtpCapabilities.encodings.length > 0) {
              // For audio streams, ensure SSRC is unique to avoid conflicts
              // This helps prevent the InvalidAccessError with setRemoteDescription
              const uniqueSsrc = Math.floor(Math.random() * 9000000) + 1000000;
              console.log(`Setting unique SSRC for audio: ${uniqueSsrc}`);
              
              rtpCapabilities.encodings.forEach(encoding => {
                if (encoding.ssrc) {
                  encoding.ssrc = uniqueSsrc;
                }
              });
            }

            const consumer = await transport.consume({
              id: transport.id,
              producerId: data.producerId,
              kind: data.kind,
              rtpParameters: rtpCapabilities,
            });
            console.log(`Consumer created for ${data.kind} from peer ${data.peerId}:`, consumer);

            // Store the track-to-peer mapping
            const trackId = consumer.track.id;
            trackToPeerMap.current.set(trackId, data.peerId);
            console.log(`Mapping track ${trackId} to peer ${data.peerId}`);

            // Set up consumer close handler
            consumer.on('transportclose', () => {
              console.log(`Consumer transport closed for peer ${data.peerId} ${data.kind}`);
              trackToPeerMap.current.delete(trackId);
              checkAndRemovePeerIfNeeded(data.peerId);
            });

            // Get or create a media stream for this peer
            let stream = peerStreams.current.get(data.peerId);
            if (!stream) {
              stream = new MediaStream();
              peerStreams.current.set(data.peerId, stream);
              console.log('New MediaStream created for peer:', data.peerId);
            }
            console.log(`Using MediaStream for peer ${data.peerId}:`, stream);
            console.log(`Stream has tracks:`, stream.getTracks().map(t => t.kind));
            
            // Add track to stream
            stream.addTrack(consumer.track);
            console.log(`${data.kind} track added to MediaStream for peer:`, data.peerId);
            
            // After adding the track, update the UI with the full stream
            setRemotePeers((prev) => {
              const exists = prev.find((p) => p.peerId === data.peerId);
              if (exists) {
                console.log(`Updating existing peer stream for ${data.peerId} with new ${data.kind} track`);
                return prev.map((p) => (p.peerId === data.peerId ? { ...p, stream } : p));
              } else {
                console.log(`Adding new peer stream for ${data.peerId} with ${data.kind} track`);
                return [...prev, { peerId: data.peerId, stream }];
              }
            });

          } catch (error) {
            console.error(`Error consuming ${data.kind} stream from ${data.peerId}:`, error);
            
            // Special handling for InvalidAccessError with SSRC issues
            if (error instanceof Error && error.name === 'InvalidAccessError' && data.kind === 'audio') {
              console.warn('Detected SSRC conflict issue with audio stream, will retry with unique IDs');
              
              // Close the failed transport
              transport.close();
              
              // Wait a moment and retry with a completely new transport
              setTimeout(() => {
                console.log('Retrying audio stream consumption with new transport...');
                
                // Generate a new unique data object with different IDs
                const retriedData = {
                  ...data,
                  retryAttempt: true,
                  uniqueId: Date.now() // Add a timestamp to make it unique
                };
                
                createRecvTransport(retriedData);
              }, 1000);
            }
          }
        });
      } catch (transportError) {
        console.error(`Error setting up transport for ${data.kind} from ${data.peerId}:`, transportError);
      }
    });

    socket.emit('createTransport', { 
      direction: 'recv',
      kind: data.kind,
      peerId: data.peerId,
     });
  }, [socket, checkAndRemovePeerIfNeeded]);

  // Update the joinRoom function to create separate audio and video transports
  const joinRoom = useCallback(async (localStream: MediaStream, explicitRoomId?: string, userId?: string) => {
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
      // Use provided userId or generate a random peerId as fallback
      const generatedPeerId = userId || `peer-${Math.random().toString(36).substring(2, 15)}`;
      setPeerId(generatedPeerId);
      console.log('Using Peer ID:', generatedPeerId);

      // If using an explicit room ID, make sure to update the state
      if (explicitRoomId && explicitRoomId !== roomId) {
        setRoomId(explicitRoomId);
      }

      // Clear any existing transports and peer data
      if (sendVideoTransportRef.current) {
        sendVideoTransportRef.current.close();
        sendVideoTransportRef.current = null;
      }
      if (sendAudioTransportRef.current) {
        sendAudioTransportRef.current.close();
        sendAudioTransportRef.current = null;
      }
      peerStreams.current.clear();
      trackToPeerMap.current.clear();

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

          // Create separate transports for audio and video
          await Promise.all([
            createSendTransport(localStream, generatedPeerId, 'video'),
            createSendTransport(localStream, generatedPeerId, 'audio')
          ]);
        });
      });

      socket.on('newConsumer', async (data: { 
        producerId: string; 
        kind: "audio" | "video"; 
        rtpParameters: any; 
        peerId: string;
        trackId?: string;
        // consumeEventName?: string; // Add support for custom event names
        // transportEventName?: string; // Add support for custom event names
      }) => {
        console.log('Received new consumer event:', data);
        await createRecvTransport(data);
      });

      socket.on('newConsumers', async (data: { 
        producers: { 
          producerId: string; 
          kind: 'audio' | 'video'; 
          rtpParameters: any; 
          peerId: string;
          trackId?: string;
        }[] 
      }) => {
        console.log('Received new consumers event:', data);

        // Process all producers in parallel
        const promises = data.producers.map(producer => {
          return new Promise(async (resolve) => {
            try {
              console.log(`Creating transport for producer ${producer.peerId} kind ${producer.kind}`);
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

      socket.on('producerClosed', (data: { peerId: string; kind?: 'audio' | 'video'; trackId?: string; }) => {
        console.log(`Producer closed for peer ${data.peerId} kind ${data.kind || 'unknown'}`);
        
        if (data.trackId) {
          // Remove the specific track mapping
          trackToPeerMap.current.delete(data.trackId);
        }
        
        // Check if we need to remove the peer entirely
        checkAndRemovePeerIfNeeded(data.peerId);
      });

      socket.on('peerDisconnected', (data: { peerId: string; }) => {
        console.log(`Peer disconnected: ${data.peerId}`);
        removePeerFromUI(data.peerId);
      });
    } catch (error) {
      console.error('Error joining room:', error);
    }
  }, [socket, roomId, createSendTransport, createRecvTransport, removePeerFromUI, checkAndRemovePeerIfNeeded]);

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
    if (sendVideoTransportRef.current) {
      sendVideoTransportRef.current.close();
      sendVideoTransportRef.current = null;
      console.log('Closed video send transport');
    }

    if (sendAudioTransportRef.current) {
      sendAudioTransportRef.current.close();
      sendAudioTransportRef.current = null;
      console.log('Closed audio send transport');
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
        // Also clear track mappings
        trackToPeerMap.current.delete(track.id);
      });
    });
    peerStreams.current.clear();
    trackToPeerMap.current.clear();

    // Remove all socket event listeners
    if (socket) {
      socket.off('joinedRoom');
      socket.off('newConsumer');
      socket.off('newConsumers');
      socket.off('transportCreated_video');
      socket.off('transportCreated_audio');
      socket.off('transportCreated_recv');
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

  // Set the first remote peer as active when available
  useEffect(() => {
    if (remotePeers.length > 0 && !activeVideoId) {
      setActiveVideoId(remotePeers[0].peerId);
    }
  }, [remotePeers, activeVideoId]);

  // Add this near the top of your file, inside the useWebRTC hook

  // Enhance the monitorPeerConnection function
  const monitorPeerConnection = (pc: RTCPeerConnection, description: string) => {
    console.log(`[ICE] Monitoring connection: ${description}`);

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
        }
      };
      // Initial update to trigger UI render
      setConnectionStats({...connectionStatsRef.current});
    }

    // Log all ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateType = event.candidate.type || 'unknown';
        
        // Update candidate counter
        if (!connectionStatsRef.current[description].candidates[candidateType]) {
          connectionStatsRef.current[description].candidates[candidateType] = 0;
        }
        connectionStatsRef.current[description].candidates[candidateType]++;
        
        // Update UI
        setConnectionStats({...connectionStatsRef.current});
        
        // Log for debugging
        console.log(`[ICE] ${description} candidate (${candidateType}): 
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
      
      // Update connection state in stats
      if (connectionStatsRef.current[description]) {
        connectionStatsRef.current[description].connectionState = pc.iceConnectionState;
        setConnectionStats({...connectionStatsRef.current});
      }
      
      if (pc.iceConnectionState === 'checking') {
        console.log(`[ICE] Checking ICE candidates for ${description}`);
      } else if (pc.iceConnectionState === 'failed') {
        console.error(`[ICE] Connection failed for ${description}`);
        
        // Force ICE restart on failure (if supported)
        try {
          pc.restartIce?.();
          console.log('[ICE] Attempted ICE restart');
        } catch (e) {
          console.warn('[ICE] ICE restart not supported or failed', e);
        }
      }
    };
    
    // Start monitoring data flow
    return monitorDataFlow(pc, description);
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
    
    // Update track info initially and when tracks change
    const updateTrackInfo = () => {
      if (!connectionStatsRef.current[description]) return;
      
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
    
    // Call initially and add track event listener
    updateTrackInfo();
    pc.addEventListener('track', updateTrackInfo);
    
    // Start interval for monitoring data flow
    const interval = setInterval(async () => {
      if (!pc || pc.connectionState === 'closed') {
        clearInterval(interval);
        return;
      }
      
      try {
        const stats = await pc.getStats();
        let totalBytesSent = 0;
        let totalBytesReceived = 0;
        
        stats.forEach(report => {
          if (report.type === 'outbound-rtp' && report.bytesSent) {
            totalBytesSent += report.bytesSent;
          }
          
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
    }, 2000); // Check every 2 seconds
    
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

  // Add this function to get formatted debug info
  const getDebugInfo = useCallback(() => {
    const info: Record<string, any> = {};
    
    // Get transport connection information
    if (sendVideoTransportRef.current) {
      info.videoTransportId = sendVideoTransportRef.current.id || 'Not available';
      info.videoTransportConnectionState = sendVideoTransportRef.current.connectionState || 'Not available';
      
      // Only attempt to get iceParameters if it's available through the API
      try {
        info.videoIceParameters = (sendVideoTransportRef.current as any).iceParameters || 'Not available';
      } catch (e) {
        info.videoIceParameters = 'Not accessible';
      }
      
      // Instead of accessing dtlsParameters directly, report connection state
      info.videoDtlsState = sendVideoTransportRef.current.connectionState;
    } else {
      info.videoTransportId = 'Video send transport not created';
      info.videoTransportConnectionState = 'Not available';
      info.videoIceParameters = 'Video send transport not created';
      info.videoDtlsState = 'Video send transport not created';
    }
    
    if (sendAudioTransportRef.current) {
      info.audioTransportId = sendAudioTransportRef.current.id || 'Not available';
      info.audioTransportConnectionState = sendAudioTransportRef.current.connectionState || 'Not available';
      
      // Only attempt to get iceParameters if it's available through the API
      try {
        info.audioIceParameters = (sendAudioTransportRef.current as any).iceParameters || 'Not available';
      } catch (e) {
        info.audioIceParameters = 'Not accessible';
      }
      
      // Instead of accessing dtlsParameters directly, report connection state
      info.audioDtlsState = sendAudioTransportRef.current.connectionState;
    } else {
      info.audioTransportId = 'Audio send transport not created';
      info.audioTransportConnectionState = 'Not available';
      info.audioIceParameters = 'Audio send transport not created';
      info.audioDtlsState = 'Audio send transport not created';
    }
    
    // Get local and remote track info
    info.localResolution = connectionStatsRef.current?.['TransportParams']?.localResolution || 'Not available';
    info.remoteResolutions = connectionStatsRef.current?.['TransportParams']?.remoteResolutions || {};
    
    return info;
  }, []);

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
    getDebugInfo, // Add the new function to the returned object
    // New exports
    trackToPeerMap: trackToPeerMap.current,
  };
};
