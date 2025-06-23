import { useState, useEffect, useCallback, useRef } from 'react';
import io, { Socket } from 'socket.io-client';

export const useSocket = (namespace = '/mediasoup') => { // Default to mediasoup namespace
  const [socket, setSocket] = useState<Socket | null>(null);
  const [wsIP, setWsIP] = useState<string>(localStorage.getItem('wsIP') || '192.168.1.240:9006');
  const [userId, setUserId] = useState<string>(localStorage.getItem('userId') || '');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(!localStorage.getItem('userId'));
  const [incomingInvitation, setIncomingInvitation] = useState<{
    roomId: string;
    peerId: string;
    inviterId: string;
  } | null>(null);
  const [showInvitationModal, setShowInvitationModal] = useState<boolean>(false);

  // Add or ensure there's an initializingRef
  const initializingRef = useRef<boolean>(false);

  const initializeSocket = useCallback(() => {
    // Prevent duplicate initialization
    if (initializingRef.current) {
      console.log(`Socket initialization for ${namespace} already in progress, skipping.`);
      return null;
    }
    
    if (!wsIP || !userId) {
      console.log('Missing wsIP or userId, cannot initialize socket');
      return null;
    }
    
    // Set flag to indicate initialization is happening
    initializingRef.current = true;
    
    try {
      // Check if we already have a socket connection
      if (socket) {
        console.log(`Closing existing socket connection for ${namespace} before creating new one`);
        socket.disconnect();
      }
      
      // Store in localStorage for persistence
      localStorage.setItem('wsIP', wsIP);
      localStorage.setItem('userId', userId);
      
      // Format the WebSocket URL correctly
      let wsUrl = wsIP.startsWith('http') || wsIP.startsWith('ws') 
        ? wsIP 
        : `wss://${wsIP}`;
        
      // Append namespace if not already part of the URL
      if (!wsUrl.endsWith(namespace)) {
        wsUrl = `${wsUrl}${namespace}`;
      }
      
      console.log(`Initializing socket connection to ${wsUrl} with userId: ${userId}`);
      
      const newSocket = io(wsUrl, {
        query: { userId },
        path: '/socket.io', // default path - may need to be configurable
        forceNew: true, // Create a new connection for each namespace
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
      
      // Setup socket connection handlers
      newSocket.on('connect', () => {
        console.log(`Socket connected successfully to namespace ${namespace}`);
        // Reset initialization flag once connected
        initializingRef.current = false;
      });
      
      newSocket.on('disconnect', (reason: string) => {
        console.log(`Socket disconnected from namespace ${namespace}:`, reason);
        // Reset initialization flag on disconnect
        initializingRef.current = false;
      });
      
      newSocket.on('error', (error: Error) => {
        console.error(`Socket error on namespace ${namespace}:`, error);
        alert(`Connection error on ${namespace}. Please try again later.`);
        // Reset initialization flag on error
        initializingRef.current = false;
      });

      // Add invitation listener (specific to WebRTC)
      if (namespace === '/mediasoup') {
        newSocket.on('invitedToRoom', (invitation: { 
          roomId: string, 
          peerId: string, 
          inviterId: string, 
          inviterProfile: {
            username: string; 
            avatarUrl: string;
          } 
        }) => {
          console.log('Received room invitation:', invitation);
          setIncomingInvitation(invitation);
          setShowInvitationModal(true);
        });
      }
      
      setSocket(newSocket);
      setShowConfigModal(false);
      
      return newSocket;
    } catch (error) {
      console.error(`Error initializing socket for namespace ${namespace}:`, error);
      // Reset initialization flag on error
      initializingRef.current = false;
      return null;
    }
  }, [wsIP, userId, socket, namespace]); // Added namespace to dependencies

  // Update disconnectSocket function to reset the initializingRef flag
  const disconnectSocket = useCallback(() => {
    if (socket) {
      console.log(`Manually disconnecting socket connection from namespace ${namespace}`);
      socket.disconnect();
      setSocket(null);
      
      // Reset the initialization flag
      initializingRef.current = false;
      console.log('Reset socket initialization flag');
      
      setShowConfigModal(true);
      return true;
    }
    return false;
  }, [socket, namespace]);

  const handleConfigSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (!wsIP.trim()) {
      alert('Please enter a valid WebSocket server address');
      return;
    }
    
    if (!userId.trim()) {
      alert('Please enter a valid User ID');
      return;
    }
    
    // Reset the initialization flag to allow new connection attempt
    initializingRef.current = false;
    console.log('Reset initialization flag before socket reconnection attempt');
    
    console.log(`Configuration submitted, initializing socket for namespace ${namespace}...`);
    initializeSocket();
  }, [wsIP, userId, initializeSocket, namespace]);

  // Only initialize socket once on component mount if credentials are available
  useEffect(() => {
    console.log(`Component mounted, checking if socket for namespace ${namespace} should auto-initialize`);
    if (wsIP && userId && !socket && !initializingRef.current) {
      console.log(`Auto-initializing socket for namespace ${namespace} from stored credentials`);
      const newSocket = initializeSocket();
      if (newSocket) {
        console.log(`Socket auto-initialized successfully for namespace ${namespace}`);
      }
    }
  }, [namespace, wsIP, userId, socket, initializeSocket]); // Added all dependencies

  // Add or ensure this function exists in the hook
  const sendInvites = useCallback((roomId: string, peerId: string, inviteeIds: string[]) => {
    if (!socket) {
      console.error('Cannot send invites: Socket not connected');
      return;
    }
    
    console.log(`Sending room invitations to ${inviteeIds.length} users for room ${roomId}`);
    socket.emit('inviteToRoom', { 
      roomId, 
      inviterId: peerId,
      inviteeIds,
      inviterProfile : { username: `user-of-${userId}`, avatarUrl: 'https://picsum.photos/seed/lilililbahlil/200/300' } 
    });
  }, [socket]);

  return {
    socket,
    wsIP,
    userId,
    showConfigModal,
    setWsIP,
    setUserId,
    setShowConfigModal,
    handleConfigSubmit,
    incomingInvitation,
    showInvitationModal,
    setShowInvitationModal,
    setIncomingInvitation,
    sendInvites,
    disconnectSocket,
    namespace,
  };
};
