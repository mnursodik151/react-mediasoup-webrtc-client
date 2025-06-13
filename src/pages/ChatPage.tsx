import React, { useState, useEffect, useRef } from 'react';
import { useChatSocket } from '../hooks/useChatSocket';
import ConfigurationModal from '../components/Meeting/ConfigurationModal';
import './ChatPage.css';

const ChatPage: React.FC = () => {
  const {
    socket,
    wsIP,
    userId,
    showConfigModal,
    setWsIP,
    setUserId,
    setShowConfigModal,
    handleConfigSubmit,
    disconnectSocket,
    messages,
    currentRoom,
    onlineUsers,
    sendMessage,
    joinRoom
  } = useChatSocket();

  const [messageInput, setMessageInput] = useState<string>('');
  const [availableRooms] = useState<string[]>(['general', 'support', 'random']);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of messages when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Join default room when socket connects
  useEffect(() => {
    if (socket) {
      joinRoom('general');
    }
  }, [socket, joinRoom]);

  const handleSubmitMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    
    sendMessage(messageInput);
    setMessageInput('');
  };

  const handleRoomChange = (roomName: string) => {
    joinRoom(roomName);
  };

  if (showConfigModal) {
    return (
      <ConfigurationModal
        wsIP={wsIP}
        setWsIP={setWsIP}
        userId={userId}
        setUserId={setUserId}
        onSubmit={handleConfigSubmit}
        onDisconnect={disconnectSocket}
        hasActiveConnection={!!socket}
      />
    );
  }

  if (!socket) {
    return (
      <div className="loading-screen">
        <p>Initializing chat connection...</p>
        <button onClick={() => setShowConfigModal(true)}>Configure Connection</button>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <h1>Real-Time Chat</h1>
        <div className="current-room">
          Room: {currentRoom}
        </div>
        <button 
          onClick={() => setShowConfigModal(true)}
          className="settings-button"
        >
          Settings
        </button>
      </header>

      <div className="chat-layout">
        <aside className="chat-sidebar">
          <div className="room-list">
            <h3>Chat Rooms</h3>
            <ul>
              {availableRooms.map(room => (
                <li 
                  key={room}
                  className={room === currentRoom ? 'active' : ''}
                  onClick={() => handleRoomChange(room)}
                >
                  #{room}
                </li>
              ))}
            </ul>
          </div>

          <div className="user-list">
            <h3>Online Users ({onlineUsers.length})</h3>
            <ul>
              {onlineUsers.map(user => (
                <li key={user} className={user === userId ? 'self' : ''}>
                  {user === userId ? `${user} (you)` : user}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="chat-main">
          <div className="message-list">
            {messages.length === 0 ? (
              <div className="empty-messages">
                No messages yet. Say hello!
              </div>
            ) : (
              messages.map((msg, index) => (
                <div 
                  key={index}
                  className={`message ${msg.senderId === userId ? 'self' : ''}`}
                >
                  <div className="message-header">
                    <span className="sender">{msg.senderId === userId ? 'You' : msg.senderId}</span>
                    <span className="timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="message-content">{msg.content}</div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="message-form" onSubmit={handleSubmitMessage}>
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type your message..."
            />
            <button type="submit">Send</button>
          </form>
        </main>
      </div>
    </div>
  );
};

export default ChatPage;
