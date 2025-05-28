import React from 'react';

interface ConfigurationModalProps {
  wsIP: string;
  setWsIP: (value: string) => void;
  userId: string;
  setUserId: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onDisconnect?: () => void;  // Add this prop
  hasActiveConnection?: boolean;  // Add this prop
}

const ConfigurationModal: React.FC<ConfigurationModalProps> = ({
  wsIP,
  setWsIP,
  userId,
  setUserId,
  onSubmit,
  onDisconnect,
  hasActiveConnection = false
}) => (
  <div className="config-modal-overlay">
    <div className="config-modal">
      <h2>Connection Configuration</h2>
      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label>WebSocket Server:</label>
          <input 
            type="text" 
            value={wsIP}
            onChange={(e) => setWsIP(e.target.value)}
            placeholder="e.g., 192.168.1.240:9006"
            required
          />
        </div>
        <div className="form-group">
          <label>User ID:</label>
          <input 
            type="text" 
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g., user-123456"
            required
          />
        </div>
        <div className="form-actions">
          {hasActiveConnection && onDisconnect && (
            <button 
              type="button" 
              onClick={onDisconnect}
              className="disconnect-button"
              style={{ 
                backgroundColor: '#d32f2f',
                marginRight: '10px'
              }}
            >
              Disconnect
            </button>
          )}
          <button type="submit">
            {hasActiveConnection ? 'Reconnect' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  </div>
);

export default ConfigurationModal;
