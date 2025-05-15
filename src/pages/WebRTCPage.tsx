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

      const peerId = `peer-${Math.random().toString(36).substring(2, 15)}`;
      setPeerId(peerId);
      console.log('Generated Peer ID:', peerId);

      socket.emit('joinRoom', { roomId, peerId });
      console.log('Emitted joinRoom event with roomId and peerId.');
      setIsJoined(true);

      socket.on('joinedRoom', async (rtpCapabilities) => {
        console.log('Received router RTP capabilities:', rtpCapabilities);
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities }).then(async () => {
          deviceRef.current = device;
          console.log('Mediasoup device loaded.', device);

          await createSendTransport(stream);
        });
      });

      socket.on('newConsumer', async (data) => {
        console.log('Received new consumer event:', data);
        await createRecvTransport(data);
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

  const createSendTransport = async (stream: MediaStream) => {
    console.log('Creating send transport...');
    socket.emit('createTransport', { direction: 'send' });
    socket.on('transportCreated', async (options: any) => {
      console.log('Send transport options received:', options);
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
          }
        );
      });

      transport.on('connectionstatechange', async (state) => {
        console.log('Send transport connection state:', state);
      });

      await captureMedia(transport).catch((error) => {
        console.error('Error capturing media:', error);
      });
    });
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
    socket.emit('createTransport', { direction: 'recv' });
    socket.on('transportCreated', async (options: any) => {
      console.log('Receive transport options received:', options);
      const transport = deviceRef.current!.createRecvTransport(options);

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
              console.error('Failed to connect send transport');
              return;
            }
            console.log('Send transport connected successfully');
          }
        );
        callback();
      });

      transport.on('connectionstatechange', async (state) => {
        console.log('Recv transport connection state:', state);
      });

      socket.emit('consume', { producerId: data.producerId, transportId: transport.id, rtpCapabilities: data.rtpParameters });
      socket.on('readyToConsume', async (rtpCapabilities) => {
        console.log('recv capabilities:', rtpCapabilities);
        console.log('deviceRef.current:', deviceRef.current?.rtpCapabilities);
        console.log('connection state:', transport.connectionState);

        const consumer = await transport.consume({
          id: transport.id,
          producerId: data.producerId,
          kind: data.kind,
          rtpParameters: rtpCapabilities,
        });
        console.log('Consumer created:', consumer);

        let stream = peerStreams.current.get(data.peerId);
        if (!stream) {
          stream = new MediaStream();
          console.log('New MediaStream created for peer:', data.peerId);
        }
        stream.addTrack(consumer.track);
        console.log('Track added to MediaStream for peer:', data.peerId);
        console.log('Consumer track:', consumer.track);
        console.log('Consumer stream:', stream);

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
      });
    });
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
    socket.disconnect();
    setIsJoined(false);
    setRemotePeers([]);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
  };

  const selectActiveVideo = (id: string) => {
    setActiveVideoId(id);
  };

  useEffect(() => {
    // Set the first remote peer as active when available
    if (remotePeers.length > 0 && !activeVideoId) {
      setActiveVideoId(remotePeers[0].peerId);
    }
  }, [remotePeers, activeVideoId]);

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
