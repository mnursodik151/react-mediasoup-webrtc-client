import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

export interface DataChannelMessage {
  type: string;
  [key: string]: any;
}

export const useWebRTCDataChannel = (socket: Socket | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [receivedData, setReceivedData] = useState<any[]>([]);

  // Device and transport references
  const deviceRef = useRef<mediasoupClient.Device | null>(null);
  const sendDataTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const recvDataTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const dataProducerRef = useRef<mediasoupClient.types.DataProducer | null>(null);
  const dataConsumersRef = useRef<Map<string, mediasoupClient.types.DataConsumer>>(new Map());

  // Clear received data
  const clearReceivedData = useCallback(() => {
    setReceivedData([]);
  }, []);

  // Create send transport for data channel
  const createSendDataTransport = useCallback(async (peerIdentifier: string) => {
    if (!socket || !deviceRef.current) return;

    console.log('Creating send data transport...');

    // Remove any existing handlers for this event before adding new ones
    socket.off('transportCreated_send_data');

    socket.once('transportCreated_send_data', async (options: any) => {
      if (!deviceRef.current) return;
      
      console.log('Received send data transport options:', options);
      
      try {
        // For doodle page, we'll make TURN servers optional
        // This can help with direct connections when we're just testing locally
        const transport = deviceRef.current.createSendTransport({
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          sctpParameters: options.sctpParameters,
          iceServers: [], // Skip TURN servers for doodle connections to try direct connection
        });
        
        console.log('Created send transport without TURN servers to attempt direct connection');

        sendDataTransportRef.current = transport;

        transport.on('connect', async ({ dtlsParameters }, callback) => {
          console.log('Send data transport connecting...');
          socket.emit(
            'connectTransport',
            {
              transportId: transport.id,
              dtlsParameters,
              kind: 'data',
              peerId: peerIdentifier
            },
            (success: boolean) => {
              if (success) {
                console.log('Send data transport connected successfully');
              } else {
                console.error('Failed to connect send data transport');
              }
              callback();
            }
          );
        });

        transport.on('produce', () => {
          console.warn('Produce event triggered on data transport - this should not happen');
        });

        transport.on('producedata', async (
          { sctpStreamParameters, label, protocol, appData },
          callback
        ) => {
          console.log('Producing data with parameters:', { sctpStreamParameters, label, protocol });
          
          socket.emit(
            'produceData',
            {
              transportId: transport.id,
              sctpStreamParameters,
              label,
              protocol,
              appData,
              peerId: peerIdentifier,
            },
            ({ id }: { id: string }) => {
              console.log('Data producer created with ID:', id);
              callback({ id });
            }
          );
        });

        console.log('Creating data producer with transport ID:', transport.id);
        
        console.log('About to create data producer with settings:',
          {
            ordered: true,
            label: 'doodle',
            protocol: 'doodle-protocol',
            transportId: transport.id
          }
        );
        
        // Create a data producer for the doodling
        const dataProducer = await transport.produceData({
          ordered: true,
          label: 'doodle',
          protocol: 'doodle-protocol',
          appData: { peerId: peerIdentifier }
        });

        console.log('Data producer created with ID:', dataProducer.id);
        
        // Log ALL available properties for debugging
        const dataProducerState = {
          closed: dataProducer.closed,
          id: dataProducer.id,
          label: dataProducer.label,
          protocol: dataProducer.protocol,
        };
        
        // Log all available properties
        console.log('Data producer initial full state:', dataProducerState);
        
        // Check if the mediasoup DataProducer is accessible
        // In mediasoup-client, we should rely on DataProducer events and state rather than underlying RTCDataChannel
        console.log('Checking mediasoup DataProducer state');
        console.log('DataProducer state:', {
          id: dataProducer.id,
          closed: dataProducer.closed,
          label: dataProducer.label,
          protocol: dataProducer.protocol,
          readyState: dataProducer.readyState
        });
        
        dataProducerRef.current = dataProducer;

        // Add a fallback mechanism in case the 'open' event never fires
        // Set a timeout to check the state after a reasonable time
        const openTimeoutId = setTimeout(() => {
          console.log('Checking data producer state after timeout');
          console.log('DataProducer readyState after timeout:', dataProducer.readyState);
          
          // Check mediasoup DataProducer readyState instead of just closed state
          if (dataProducer.readyState === 'open') {
            console.log('DataProducer readyState is open after timeout, setting connected');
            setIsConnected(true);
          } else {
            console.warn('DataProducer readyState is not open after timeout:', dataProducer.readyState);
          }
        }, 3000); // 3 second timeout
        
        dataProducer.on('transportclose', () => {
          console.log('Data producer transport closed');
          dataProducerRef.current = null;
          setIsConnected(false);
          clearTimeout(openTimeoutId);
        });

        dataProducer.on('open', () => {
          console.log('Data producer opened and ready to send data!');
          setIsConnected(true);
          clearTimeout(openTimeoutId);
        });

        dataProducer.on('close', () => {
          console.log('Data producer closed');
          dataProducerRef.current = null;
          setIsConnected(false);
          clearTimeout(openTimeoutId);
        });

        dataProducer.on('error', (error) => {
          console.error('Data producer error:', error);
          setIsConnected(false);
          clearTimeout(openTimeoutId);
        });

        // Signal ready to receive data from peers
        console.log(`Ready to receive data on send transport for peer: ${peerIdentifier} room: ${roomId}`);

        // Add extra debugging for room ID
      console.log(`Sending readyToReceiveData with roomId: "${roomId}" (type: ${typeof roomId}) peerId: ${peerIdentifier}`);
      if (roomId === null) {
        console.warn('roomId is null! Using default roomId "doodle-room" instead');
        socket.emit('readyToReceiveData', { roomId: 'doodle-room', peerId: peerIdentifier });
      } else {
        socket.emit('readyToReceiveData', { roomId: roomId, peerId: peerIdentifier });
      }

      } catch (error) {
        console.error('Error creating send data transport:', error);
      }
    });

    socket.emit('createTransport', {
      direction: 'send',
      kind: 'data',
      peerId: peerIdentifier,
      sctpCapabilities: deviceRef.current.sctpCapabilities
    });
  }, [socket, roomId]);

  // Create receive transport for data channel
  const createRecvDataTransport = useCallback(async (peerIdentifier: string) => {
    if (!socket || !deviceRef.current) return;

    console.log('Creating receive data transport...');

    // Remove any existing handlers for this event before adding new ones
    socket.off('transportCreated_recv_data');

    socket.once('transportCreated_recv_data', async (options: any) => {
      if (!deviceRef.current) return;
      
      console.log('Received receive data transport options:', options);
      
      try {
        // For doodle page, we'll make TURN servers optional
        // This can help with direct connections when we're just testing locally
        const transport = deviceRef.current.createRecvTransport({
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          sctpParameters: options.sctpParameters,
          iceServers: [], // Skip TURN servers for doodle connections to try direct connection
        });
        
        console.log('Created receive transport without TURN servers to attempt direct connection');

        recvDataTransportRef.current = transport;

        transport.on('connect', async ({ dtlsParameters }, callback) => {
          console.log('Receive data transport connecting...');
          socket.emit(
            'connectTransport',
            {
              transportId: transport.id,
              dtlsParameters,
              kind: 'data',
              peerId: peerIdentifier
            },
            (success: boolean) => {
              if (success) {
                console.log('Receive data transport connected successfully');
              } else {
                console.error('Failed to connect receive data transport');
              }
              callback();
            }
          );
        });

        // Now signal we're ready for data consumers
        // Add extra debugging for room ID
        console.log(`Sending consumeAllExistingData with roomId: "${roomId}" (type: ${typeof roomId}) peerId: ${peerIdentifier}`);
        if (roomId === null) {
          console.warn('roomId is null! Using default roomId "doodle-room" instead');
          socket.emit('consumeAllExistingData', { 
            transportId: transport.id,
            roomId: 'doodle-room', 
            peerId: peerIdentifier,
            sctpCapabilities: deviceRef.current.sctpCapabilities
          });
        } else {
          socket.emit('consumeAllExistingData', { 
            transportId: transport.id,
            roomId: roomId, 
            peerId: peerIdentifier,
            sctpCapabilities: deviceRef.current.sctpCapabilities
          });
        }
      } catch (error) {
        console.error('Error creating receive data transport:', error);
      }
    });

    socket.emit('createTransport', {
      direction: 'recv',
      kind: 'data',
      peerId: peerIdentifier,
      sctpCapabilities: deviceRef.current.sctpCapabilities
    });
  }, [socket, roomId]);

  // Create a data consumer
  const createDataConsumer = useCallback(async (data: any) => {
    if (!socket || !recvDataTransportRef.current || !deviceRef.current) return;

    try {
      console.log('Creating data consumer for producer:', data);
      
      const { 
        producerId, 
        producerPeerId, 
        peerId, 
        sctpStreamParameters, 
        label, 
        protocol, 
        appData 
      } = data;

      const transport = recvDataTransportRef.current;
      if(!data.producerId) {
        console.error('Data consumer creation failed - producerId is missing:', data);
        return;
      }
      const id = `data.peerId_${peerId}_producer_${producerId}`;
      const dataConsumer = await transport.consumeData({
        id,
        dataProducerId: producerId,
        sctpStreamParameters,
        label,
        protocol,
        appData: { ...appData, producerPeerId }
      });

      dataConsumersRef.current.set(id, dataConsumer);
      
      console.log('Data consumer created:', { id, label, protocol });

      dataConsumer.on('message', (message) => {
        // Log the raw message type first
        console.log(`Data consumer received raw message of type: ${typeof message}`, 
                   typeof message === 'object' ? 'Object/ArrayBuffer' : message);
                   
        // Parse the message if it's a string
        let parsedMessage;
        try {
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
            console.log('Successfully parsed string message to JSON');
          } else if (message instanceof ArrayBuffer) {
            // Convert ArrayBuffer to string and try to parse
            const decoder = new TextDecoder('utf-8');
            const text = decoder.decode(message);
            console.log('Decoded ArrayBuffer to string:', text);
            parsedMessage = JSON.parse(text);
            console.log('Successfully parsed ArrayBuffer message to JSON');
          } else {
            parsedMessage = message;
            console.log('Using message as-is (not string or ArrayBuffer)');
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
          parsedMessage = message;
        }

        console.log('Data consumer received parsed message:', parsedMessage);
        console.log('Data consumer label:', dataConsumer.label);
        console.log('Producer peer ID:', (dataConsumer.appData as any).producerPeerId);
        
        setReceivedData(prev => {
          console.log(`Adding new message to receivedData queue (current length: ${prev.length})`);
          return [...prev, parsedMessage];
        });
      });

      dataConsumer.on('close', () => {
        console.log('Data consumer closed:', id);
        dataConsumersRef.current.delete(id);
      });

      // Tell the server we're ready to consume data
      socket.emit('resumeDataConsumer', { 
        dataConsumerId: id,
        peerId: peerId
      });
    } catch (error) {
      console.error('Error creating data consumer:', error);
    }
  }, [socket, peerId]);

  // Consume a specific data producer
  const consumeSpecificDataProducer = useCallback(async (producerId: string, producerPeerId: string) => {
    if (!socket || !recvDataTransportRef.current || !deviceRef.current) {
      console.error('Cannot consume data producer - transport or device not ready');
      return;
    }

    try {
      console.log(`Requesting to consume specific data producer: ${producerId} from peer: ${producerPeerId}`);
      
      socket.emit('consumeData', {
        transportId: recvDataTransportRef.current.id,
        producerId,
        sctpCapabilities: deviceRef.current.sctpCapabilities,
        peerId: peerId
      });
      
      // Set up a one-time handler for the specific consumer
      const consumeReadyEventName = `readyToConsumeData_${peerId}_${producerId}`;
      socket.once(consumeReadyEventName, async (data: any) => {
        await createDataConsumer(data);
      });
      
    } catch (error) {
      console.error('Error consuming specific data producer:', error);
    }
  }, [socket, peerId, createDataConsumer]);

  // Join a room
  const joinRoom = useCallback(async (roomToJoin: string, userId?: string) => {
    if (!socket) {
      console.error('Socket connection not established');
      return;
    }

    console.log('Attempting to join doodle room:', roomToJoin);
    
    try {
      // Use provided userId or generate a random peerId
      const generatedPeerId = userId || `peer-${Math.random().toString(36).substring(2, 15)}`;
      setPeerId(generatedPeerId);
      console.log('Using Peer ID:', generatedPeerId);
      setRoomId(roomToJoin);

      // Clear any existing state
      if (dataProducerRef.current) {
        dataProducerRef.current.close();
        dataProducerRef.current = null;
      }
      
      if (sendDataTransportRef.current) {
        sendDataTransportRef.current.close();
        sendDataTransportRef.current = null;
      }
      
      if (recvDataTransportRef.current) {
        recvDataTransportRef.current.close();
        recvDataTransportRef.current = null;
      }
      
      dataConsumersRef.current.clear();
      clearReceivedData();

      // Join the room
      socket.emit('joinRoom', { roomId: roomToJoin, peerId: generatedPeerId });
      console.log('Emitted joinRoom event with roomId and peerId:', { roomToJoin, generatedPeerId });
      
      // Handle socket events
      socket.on('joinedRoom', async (data: any) => {
        console.log('Joined room, received router capabilities:', data);
        
        // Extract RTP capabilities from the response (could be directly rtpCapabilities or nested in an object)
        const rtpCapabilities = data.routerRtpCapabilities || data;
        
        const device = new mediasoupClient.Device();
        
        // Load the device with the router's RTP capabilities
        await device.load({ routerRtpCapabilities: rtpCapabilities }).then(() => {
          // Log if we got SCTP capabilities from the server
          if (data.routerSctpCapabilities) {
            console.log('Server provided SCTP capabilities:', data.routerSctpCapabilities);
          }
          deviceRef.current = device;
          console.log('Mediasoup device loaded with SCTP capabilities:', device.sctpCapabilities);
          
          // Create data transports
          createSendDataTransport(generatedPeerId);
          createRecvDataTransport(generatedPeerId);
          
          // We'll set isConnected to true when the data producer emits 'open' event
          // This ensures we only try to send data when the channel is actually ready
          console.log('Transport setup complete, waiting for data producer to be ready...');
        });
      });

      socket.on('newDataConsumer', async (data: any) => {
        console.log('Received new data consumer event:', data);
        await consumeSpecificDataProducer(data.producerId, data.producerPeerId);
      });

      socket.on('newDataConsumers', async (data: { producers: any[] }) => {
        console.log('Received multiple data consumers:', data);
        
        const promises = data.producers.map(producer => {
          return new Promise(async (resolve) => {
            try {
              await consumeSpecificDataProducer(producer.producerId, producer.producerPeerId);
              resolve(true);
            } catch (error) {
              console.error('Error creating data consumer:', error);
              resolve(false);
            }
          });
        });

        await Promise.all(promises);
        console.log('Finished processing all new data consumers');
      });

      socket.on('dataProducerClosed', (data: { peerId: string; dataProducerId: string }) => {
        console.log('Data producer closed:', data);
        
        // Find and close the corresponding data consumer
        dataConsumersRef.current.forEach((consumer, id) => {
          if (consumer.dataProducerId === data.dataProducerId) {
            console.log('Closing data consumer for closed producer:', id);
            consumer.close();
            dataConsumersRef.current.delete(id);
          }
        });
      });

      socket.on('peerDisconnected', (data: { peerId: string }) => {
        console.log('Peer disconnected:', data.peerId);
        
        // Close all data consumers associated with this peer
        dataConsumersRef.current.forEach((consumer, id) => {
          const appData = consumer.appData as any;
          if (appData.producerPeerId === data.peerId) {
            console.log('Closing data consumer for disconnected peer:', id);
            consumer.close();
            dataConsumersRef.current.delete(id);
          }
        });
      });
      
      // Handle when other peers are ready to receive data
      socket.on('peerReadyForData', (data: { peerId: string }) => {
        console.log('Peer ready for data:', data.peerId);
        // If needed, you can implement additional logic here when other peers are ready
      });

    } catch (error) {
      console.error('Error joining room:', error);
    }
  }, [socket, clearReceivedData, createSendDataTransport, createRecvDataTransport, createDataConsumer]);

  // Leave a room
  const leaveRoom = useCallback(() => {
    if (!socket || !isConnected || !roomId || !peerId) return;

    console.log('Leaving room:', roomId);
    
    socket.emit('leaveRoom', { roomId, peerId });
    
    // Clean up
    cleanupResources();
    setIsConnected(false);
    setRoomId(null);
  }, [socket, isConnected, roomId, peerId]);

  // Clean up resources
  const cleanupResources = useCallback(() => {
    console.log('Cleaning up resources');
    
    // Set connection state to false first
    setIsConnected(false);
    
    // Close data producer
    if (dataProducerRef.current) {
      dataProducerRef.current.close();
      dataProducerRef.current = null;
    }
    
    // Close all data consumers
    dataConsumersRef.current.forEach(consumer => {
      consumer.close();
    });
    dataConsumersRef.current.clear();
    
    // Close transports
    if (sendDataTransportRef.current) {
      sendDataTransportRef.current.close();
      sendDataTransportRef.current = null;
    }
    
    if (recvDataTransportRef.current) {
      recvDataTransportRef.current.close();
      recvDataTransportRef.current = null;
    }
    
    // Remove socket listeners
    if (socket) {
      socket.off('joinedRoom');
      socket.off('transportCreated_send_data');
      socket.off('transportCreated_recv_data');
      socket.off('newDataConsumer');
      socket.off('newDataConsumers');
      socket.off('dataProducerClosed');
      socket.off('peerDisconnected');
      socket.off('peerReadyForData');
      
      // Also remove any dynamic event listeners for data consumers
      // (pattern matching would require server-side support)
      // If you have specific patterns, you could use them here
    }
    
    clearReceivedData();
  }, [socket, clearReceivedData]);

  // Send data through the data channel
  const sendData = useCallback((data: any) => {
    if (!dataProducerRef.current) {
      console.error('Data producer not created yet');
      return false;
    }

    try {
      // Check if data producer is closed
      if (dataProducerRef.current.closed) {
        console.error('Data producer is closed, cannot send data');
        setIsConnected(false);
        return false;
      }
      
      // Check our connection status flag - but make an exception for manual override
      if (!isConnected) {
        // The flag is controlled by events or by the fallback mechanism
        console.warn('Data channel not marked as connected according to app state. Will attempt to send anyway.');
        // We're not returning false here - we'll try to send regardless
      }
      
      // Additional check: verify the readyState is 'open' before sending
      if (dataProducerRef.current.readyState !== 'open') {
        console.warn(`DataProducer readyState is '${dataProducerRef.current.readyState}', not 'open'. Attempting to send anyway.`);
      }
      
      // Check mediasoup DataProducer readyState directly
      console.log('MediaSoup DataProducer state:', {
        id: dataProducerRef.current.id,
        closed: dataProducerRef.current.closed,
        label: dataProducerRef.current.label,
        protocol: dataProducerRef.current.protocol,
        readyState: dataProducerRef.current.readyState
      });
      
      // Add debug information about the data producer
      console.log('DataProducer before sending:', {
        id: dataProducerRef.current.id,
        closed: dataProducerRef.current.closed,
        readyState: dataProducerRef.current.readyState
      });
      
      // Convert data to string if it's an object
      const message = typeof data === 'object' ? JSON.stringify(data) : data;
      
      // Wrap the send in a try-catch inside the try block to handle specific send errors
      try {
        // Always try to send - mediasoup might handle this differently than raw WebRTC
        dataProducerRef.current.send(message);
        console.log('Data sent successfully:', data);
        
        // If we successfully sent data, then we know the channel is actually working
        if (!isConnected) {
          console.log('Data was sent successfully despite not being marked as connected. Updating state.');
          setIsConnected(true);
        }
        
        return true;
      } catch (sendError) {
        console.error('Error during send operation:', sendError);
        if (sendError instanceof Error && sendError.message.includes('closed')) {
          console.warn('Data channel appears to be closed during send');
          setIsConnected(false);
        }
        throw sendError; // Re-throw to be caught by outer catch block
      }
    } catch (error) {
      console.error('Error sending data:', error);
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      
      // Log the data producer state at time of error
      if (dataProducerRef.current) {
        console.log('DataProducer state during error:', {
          id: dataProducerRef.current.id,
          closed: dataProducerRef.current.closed,
          // Log any other properties that might be useful
        });
      }
      
      // If we get an error about the connection state, update our isConnected flag
      if (error instanceof Error && 
          (error.message.includes('readyState') || 
           error.message.includes('state') || 
           error.message.includes('closed') || 
           error.message.includes('send'))) {
        console.warn('Setting connected status to false due to send error');
        setIsConnected(false);
      }
      return false;
    }
  }, [isConnected]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return {
    isConnected,
    roomId,
    peerId,
    receivedData,
    joinRoom,
    leaveRoom,
    sendData,
    clearReceivedData,
    consumeSpecificDataProducer
  };
};
