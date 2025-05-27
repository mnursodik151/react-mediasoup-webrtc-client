import React from 'react';

interface ControlBarProps {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onOpenInvite: () => void;
  onDisconnect: () => void;
  onOpenSettings: () => void;
}

const ControlBar: React.FC<ControlBarProps> = ({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onOpenInvite,
  onDisconnect,
  onOpenSettings
}) => (
  <div className="control-bar">
    <button
      className={`control-button ${isMuted ? 'active' : ''}`}
      onClick={onToggleMute}
    >
      {isMuted ? 'Unmute' : 'Mute'}
    </button>
    <button
      className={`control-button ${isVideoOff ? 'active' : ''}`}
      onClick={onToggleVideo}
    >
      {isVideoOff ? 'Turn On Video' : 'Turn Off Video'}
    </button>
    <button 
      className="control-button invite"
      onClick={onOpenInvite}
    >
      Invite Users
    </button>
    <button 
      className="control-button disconnect" 
      onClick={onDisconnect}
    >
      Leave Meeting
    </button>
    <button 
      className="control-button settings" 
      onClick={onOpenSettings}
    >
      Settings
    </button>
  </div>
);

export default ControlBar;
