import React, { useRef, useState, useEffect } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import './WebRTCPage.css'; // You'll need to create this CSS file

const socket = io('wss://192.168.1.108:9006'); // adjust to your server

type PeerStream = {
  peerId: string;
  stream: MediaStream;
};

export default function MediaRoom() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remotePeers, setRemotePeers] = useState<PeerStream[]>([]);
  const [roomId, setRoomId] = useState('');
  const [peerId, setPeerId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const deviceRef = useRef<mediasoupClient.Device | null>(null);
  const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const peerStreams = useRef<Map<string, MediaStream>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const cleanupSocketAndMedia = () => {
    console.log('Cleaning up socket connections and media resources');

    // Send leave room event if we're in a room
    if (isJoined && roomId && peerId) {
      socket.emit('leaveRoom', { roomId, peerId });
      console.log('Emitted leaveRoom event on cleanup');
    }

    // Clean up all media tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('Stopped local track:', track.kind);
      });
      localStreamRef.current = null;
    }

    // Close and clean up all peer streams
    peerStreams.current.forEach((stream, peerId) => {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped track for peer ${peerId}:`, track.kind);
      });
    });
    peerStreams.current.clear();

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

    // Remove all socket event listeners
    socket.off('joinedRoom');
    socket.off('newConsumer');
    socket.off('newConsumers');
    socket.off('transportCreated');
    socket.off('readyToConsume');
    socket.off('producerClosed');
    socket.off('peerDisconnected');
    socket.off('leftRoom');

    // Reset UI state
    setIsJoined(false);
    setRemotePeers([]);
    setActiveVideoId(null);
  };

  const joinRoom = async () => {
    console.log('Attempting to join room:', roomId);
    if (!roomId) {
      alert('Room ID is required to join a room.');
      return;
    }

    try {
      console.log('Requesting user media...');
      const stream = await getMediaStream();
      localStreamRef.current = stream;
      console.log('User media obtained:', stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();
        console.log('Local video stream set.');
      }

      // Generate peer ID as a local variable
      const generatedPeerId = `peer-${Math.random().toString(36).substring(2, 15)}`;
      // Update state (async operation)
      setPeerId(generatedPeerId);
      console.log('Generated Peer ID:', generatedPeerId);

      // Use the local variable instead of state
      socket.emit('joinRoom', { roomId, peerId: generatedPeerId });
      console.log('Emitted joinRoom event with roomId and peerId:', generatedPeerId);
      setIsJoined(true);

      socket.on('joinedRoom', async (rtpCapabilities) => {
        console.log('Received router RTP capabilities:', rtpCapabilities);
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities }).then(async () => {
          deviceRef.current = device;
          console.log('Mediasoup device loaded.', device);

          // Pass the generated peerId to createSendTransport
          await createSendTransport(stream, generatedPeerId);
        });
      });

      socket.on('newConsumer', async (data) => {
        console.log('Received new consumer event:', data);
        await createRecvTransport(data);
      });

      socket.on('newConsumers', async (data: { producers: { producerId: string; kind: 'audio' | 'video'; rtpParameters: any; peerId: string; }[] }) => {
        console.log('Received new consumers event:', data);

        // Process all producers in parallel instead of sequentially
        const promises = data.producers.map(producer => {
          return new Promise(async (resolve) => {
            try {
              console.log(`Creating transport for producer ${producer.peerId}`);
              await createRecvTransport(producer);
              resolve(true);
            } catch (error) {
              console.error(`Error creating transport for producer ${producer.peerId}:`, error);
              resolve(false); // Resolve even on error to continue with other producers
            }
          });
        });

        // Wait for all processes to complete but don't block if one fails
        await Promise.all(promises);
        console.log('Finished processing all new consumers');
      });

      // Add listener for producer closed events
      socket.on('producerClosed', (data) => {
        console.log(`Producer closed for peer ${data.peerId}`);
        removePeerFromUI(data.peerId);
      });

      socket.on('peerDisconnected', (data) => {
        console.log(`Peer disconnected: ${data.peerId}`);
        removePeerFromUI(data.peerId);
      });
    } catch (error) {
      console.error('Error joining room:', error);
    }
  };

  const getMediaStream = async (): Promise<MediaStream> => {
    try {
      const constraints = {
        video: { facingMode: 'user' }, // Use 'environment' for the rear camera
        audio: true,
      };
      console.log('Requesting media with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Media stream obtained:', stream);
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Could not access camera or microphone. Please check permissions.');
      throw error;
    }
  };

  const createSendTransport = async (stream: MediaStream, peerIdentifier: string) => {
    console.log('Creating send transport...');

    // Remove any existing handlers for this event before adding new ones
    socket.off('transportCreated');

    // Use once instead of on to ensure the handler only executes once
    socket.once('transportCreated', async (options: any) => {
      console.log('Send transport options received:', options);

      // Only create transport if it doesn't exist
      if (!sendTransportRef.current) {
        const transport = deviceRef.current!.createSendTransport(options);
        sendTransportRef.current = transport;

        transport.on('connect', async ({ dtlsParameters }, callback) => {
          console.log('Send transport connecting...');
          await socket.emit(
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
          await socket.emit(
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
          await captureMedia(transport);
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
  };

  const captureMedia = async (transport: mediasoupClient.types.Transport) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const videoTrack = stream.getVideoTracks()[0];

      if (videoTrack) {
        await transport.produce({ track: videoTrack });
      }
    } catch (error) {
      console.error('Error capturing media:', error);
      alert('Could not access camera or microphone. Please check permissions.');
      throw error;
    }
  };

  const createRecvTransport = async (data: { producerId: string; kind: 'audio' | 'video'; rtpParameters: any; peerId: string }) => {
    console.log('Creating receive transport...');

    // Remove any existing handlers for this event
    socket.off('transportCreated');
    socket.off('readyToConsume');

    socket.once('transportCreated', async (options: any) => {
      console.log('Receive transport options received:', options);
      const transport = deviceRef.current!.createRecvTransport(options);

      // Store transport with peer ID for cleanup
      console.log(`Storing transport for peer ${data.peerId}, ID: ${transport.id}`);
      const transportId = transport.id;

      transport.on('connect', async ({ dtlsParameters }, callback) => {
        console.log('Recv transport connecting...');
        await socket.emit(
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
      socket.once('readyToConsume', async (rtpCapabilities) => {
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

          // consumer.on('close', () => {
          //   console.log(`Consumer closed for peer ${data.peerId}`);
          //   removePeerFromUI(data.peerId);
          // });

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
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = isVideoOff;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleDisconnect = () => {
    console.log('User initiated disconnect');
    
    // First notify the server we're leaving
    socket.emit('leaveRoom', { roomId, peerId });
    console.log('Emitted leaveRoom event with roomId and peerId:', peerId);
    
    socket.off('leftRoom');
    socket.once('leftRoom', () => {
      console.log('Server acknowledged room exit');
      cleanupSocketAndMedia();
    });

    // Set timeout to force cleanup if server doesn't respond
    setTimeout(() => {
      console.log('Timeout reached, forcing cleanup');
      cleanupSocketAndMedia();
    }, 2000); // 2 second timeout as fallback
  };

  const selectActiveVideo = (id: string) => {
    setActiveVideoId(id);
  };

  const removePeerFromUI = (peerId: string) => {
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
    if (activeVideoId === peerId) {
      setActiveVideoId('local');
    }
  };

  useEffect(() => {
    // Set the first remote peer as active when available
    if (remotePeers.length > 0 && !activeVideoId) {
      setActiveVideoId(remotePeers[0].peerId);
    }
  }, [remotePeers, activeVideoId]);

  useEffect(() => {
    // Setup beforeunload event to handle page refreshes and closures
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Call cleanup function when page is about to unload
      cleanupSocketAndMedia();
      // Modern browsers need returnValue set
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup function for component unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupSocketAndMedia();
    };
  }, []);

  useEffect(() => {
    // Connect socket if not connected
    if (socket.disconnected) {
      socket.connect();
    }

    // Setup socket error and connection event handlers
    const handleSocketConnect = () => {
      console.log('Socket connected');
    };

    const handleSocketDisconnect = (reason: string) => {
      console.log('Socket disconnected:', reason);
      if (isJoined) {
        // If we were in a meeting, clean up everything
        cleanupSocketAndMedia();
        alert('You were disconnected from the server. Please rejoin the meeting.');
      }
    };

    const handleSocketError = (error: Error) => {
      console.error('Socket error:', error);
      alert('Connection error. Please try again later.');
    };

    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleSocketDisconnect);
    socket.on('error', handleSocketError);

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('disconnect', handleSocketDisconnect);
      socket.off('error', handleSocketError);
    };
  }, [isJoined]);

  if (!isJoined) {
    return (
      <div className="join-screen">
        <div className="join-container">
          <h1>Video Conference</h1>
          <div className="join-preview">
            <video ref={localVideoRef} autoPlay muted playsInline />
          </div>
          <div className="join-form">
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter meeting code"
            />
            <button onClick={joinRoom}>Join Meeting</button>
          </div>
        </div>
      </div>
    );
  }

  // Get the active stream
  const activeStream =
    activeVideoId
      ? remotePeers.find((p) => p.peerId === activeVideoId)?.stream ||
      (localStreamRef.current && activeVideoId === 'local' ? localStreamRef.current : null)
      : null;

  return (
    <div className="meeting-room">
      <div className="main-area">
        {activeStream ? (
          <div className="main-video-container">
            <video
              autoPlay
              playsInline
              ref={(video) => {
                if (video && activeStream) {
                  // Only set srcObject if it's different to avoid constant reattachment
                  if (video.srcObject !== activeStream) {
                    video.srcObject = activeStream;
                  }
                }
              }}
            />
            <div className="video-name">
              {activeVideoId === 'local' ? 'You' : `Participant (${activeVideoId})`}
            </div>
          </div>
        ) : (
          <div className="no-video">No active video selected</div>
        )}
      </div>

      <div className="participants-strip">
        <div
          className={`participant-tile ${activeVideoId === 'local' ? 'active' : ''}`}
          onClick={() => selectActiveVideo('local')}
        >
          <video
            autoPlay
            muted
            playsInline
            ref={(video) => {
              if (video && localStreamRef.current) {
                // Only set srcObject if it's different to avoid constant reattachment
                if (video.srcObject !== localStreamRef.current) {
                  video.srcObject = localStreamRef.current;
                }
              }
            }}
          />
          <div className="participant-name">You</div>
        </div>

        {remotePeers.map(({ peerId, stream }) => (
          <div
            key={peerId}
            className={`participant-tile ${activeVideoId === peerId ? 'active' : ''}`}
            onClick={() => selectActiveVideo(peerId)}
          >
            <video
              autoPlay
              playsInline
              ref={(video) => {
                if (video && stream) {
                  // Only set srcObject if it's different to avoid constant reattachment
                  if (video.srcObject !== stream) {
                    video.srcObject = stream;
                  }
                }
              }}
            />
            <div className="participant-name">Participant</div>
          </div>
        ))}
      </div>

      <div className="control-bar">
        <button
          className={`control-button ${isMuted ? 'active' : ''}`}
          onClick={toggleMute}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button
          className={`control-button ${isVideoOff ? 'active' : ''}`}
          onClick={toggleVideo}
        >
          {isVideoOff ? 'Turn On Video' : 'Turn Off Video'}
        </button>
        <button className="control-button disconnect" onClick={handleDisconnect}>
          Leave Meeting
        </button>
      </div>
    </div>
  );
}
