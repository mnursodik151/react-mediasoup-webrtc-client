import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './useSocket';

// Define message type
export interface ChatMessage { 
  meetingId: string; 
  content: string; 
  userId: string; 
  attachmentId?: string; 
}

export const useChatSocket = () => {
  // Use the base socket hook with chat namespace
  const {
    socket,
    wsIP,
    userId,
    showConfigModal,
    setWsIP,
    setUserId,
    setShowConfigModal,
    handleConfigSubmit,
    disconnectSocket
  } = useSocket('/chat');

  // Chat specific state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('general');
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  // Initialize chat event listeners
  useEffect(() => {
    if (!socket) return;

    // Handle incoming messages
    socket.on('chatMessage', (message: ChatMessage) => {
      console.log('Received chat message:', message);
      setMessages(prev => [...prev, message]);
    });

    // Handle online users updates
    socket.on('onlineUsers', (users: string[]) => {
      console.log('Online users updated:', users);
      setOnlineUsers(users);
    });

    // Handle room join confirmations
    socket.on('joinedRoom', (roomName: string) => {
      console.log(`Joined chat room: ${roomName}`);
      setCurrentRoom(roomName);
      // Clear previous room messages
      setMessages([]);
    });

    // Clean up listeners on unmount
    return () => {
      socket.off('chatMessage');
      socket.off('onlineUsers');
      socket.off('joinedRoom');
    };
  }, [socket]);

  // Function to send a chat message
  const sendMessage = useCallback((content: string) => {
    if (!socket || !content.trim()) return;

    const message: ChatMessage = {
      content,
      meetingId: '8c8927ec-3413-4a6c-8518-115520f9ebbd',
      userId: '69a5022d-415c-4627-aa42-4593cae1e06a',
      attachmentId: '68b02400808cd63c135c0db8', // Placeholder for future attachment support
    };

    console.log('Sending chat message:', message);
    socket.emit('sendChatMessage', message);
  }, [socket, userId, currentRoom]);

  // Function to join a chat room
  const joinRoom = useCallback((roomName: string) => {
    if (!socket) return;

    console.log(`Attempting to join chat room: ${roomName}`);
    socket.emit('joinRoom', { roomName });
  }, [socket]);

  // Add the joinChatRoom function to match the backend handler
  const joinChatRoom = useCallback((meetingId: string) => {
    if (!socket) {
      console.error('Cannot join chat room: Socket not connected');
      return;
    }

    console.log(`Emitting joinChatRoom event for meeting: ${meetingId}`);
    socket.emit('joinChatRoom', { meetingId });

    // Listen for successful join response if needed
    socket.once('joinedChatRoom', (response: { meetingId: string, success: boolean }) => {
      if (response.success) {
        console.log(`Successfully joined chat room for meeting: ${response.meetingId}`);
        setCurrentRoom(response.meetingId);
        // Clear previous messages when joining a new room
        setMessages([]);
      } else {
        console.error(`Failed to join chat room for meeting: ${response.meetingId}`);
      }
    });
  }, [socket]);

  return {
    // Base socket properties
    socket,
    wsIP,
    userId,
    showConfigModal,
    setWsIP,
    setUserId,
    setShowConfigModal,
    handleConfigSubmit,
    disconnectSocket,

    // Chat specific properties and methods
    messages,
    currentRoom,
    onlineUsers,
    sendMessage,
    joinRoom, // Keep existing method for backward compatibility
    joinChatRoom, // Add new method that matches backend signature
  };
};
