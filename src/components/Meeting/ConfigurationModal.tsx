import React from 'react';

interface ConfigurationModalProps {
  wsIP: string;
  setWsIP: (value: string) => void;
  userId: string;
  setUserId: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const ConfigurationModal: React.FC<ConfigurationModalProps> = ({
  wsIP,
  setWsIP,
  userId,
  setUserId,
  onSubmit
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
          <button type="submit">Connect</button>
        </div>
      </form>
    </div>
  </div>
);

export default ConfigurationModal;
