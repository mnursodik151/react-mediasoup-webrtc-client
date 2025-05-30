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

  const createSendTransport = useCallback(async (stream: MediaStream, peerIdentifier: string) => {
    if (!socket) return;
    
    console.log('Creating send transport...');

    // Remove any existing handlers for this event before adding new ones
    socket.off('transportCreated');

    // Use once instead of on to ensure the handler only executes once
    socket.once('transportCreated', async (options: any) => {
      console.log('Send transport options received:', options);

      // Only create transport if it doesn't exist
      if (!sendTransportRef.current && deviceRef.current) {
        // Properly extract and use TURN servers from the options
        const transportOptions = {
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          iceServers: options.turnServers // Use the TURN servers from server
        };
        
        console.log('Creating send transport with TURN servers:', options.turnServers);
        const transport = deviceRef.current.createSendTransport(transportOptions);
        sendTransportRef.current = transport;

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
      if (videoTrack) {
        console.log(`Producing video track with preferred codec: ${preferredCodec}`);
        
        // Configure codec options and encodings for better performance in limited bandwidth
        const codecOptions = {
          videoGoogleStartBitrate: 1000 // Starting bitrate in kbps
        };
        
        // Create simulcast encodings for different bandwidth scenarios
        const encodings = [
          { maxBitrate: 300000, scaleResolutionDownBy: 4, priority: "low" as const },
          { maxBitrate: 900000, scaleResolutionDownBy: 2, priority: "medium" as const },
          { maxBitrate: 1500000, scaleResolutionDownBy: 1, priority: "high" as const }
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
            // Use simplified codec approach - only pass mimeType and payloadType to avoid incompatible parameters
            const safeCodec = {
              kind: 'video' as mediasoupClient.types.MediaKind,  // Correctly type as MediaKind
              mimeType: codec.mimeType,
              payloadType: codec.preferredPayloadType,
              clockRate: codec.clockRate,
              channels: codec.channels
            };
            
            await transport.produce({
              track: videoTrack,
              encodings,
              codecOptions,
              codec: safeCodec
            });
          } else {
            console.warn(`Using default codec as ${preferredCodec} not available or selected`);
            await transport.produce({ track: videoTrack, encodings });
          }
        } catch (codecError) {
          console.warn('Error using preferred codec, falling back to default:', codecError);
          // If codec selection fails, fall back to default codec selection
          await transport.produce({ track: videoTrack, encodings });
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
      
      // Properly extract and use TURN servers from the options
      const transportOptions = {
        id: options.id,
        iceParameters: options.iceParameters,
        iceCandidates: options.iceCandidates,
        dtlsParameters: options.dtlsParameters,
        iceServers: options.turnServers // Use the TURN servers from server
      };
      
      console.log('Creating receive transport with TURN servers:', options.turnServers);
      const transport = deviceRef.current!.createRecvTransport(transportOptions);

      console.log(`Storing transport for peer ${data.peerId}, ID: ${transport.id}`);

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
    setPreferredCodec
  };
};
