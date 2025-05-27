import React, { useEffect } from 'react';

interface InvitationModalProps {
  invitation: {
    roomId: string;
    peerId: string;
    inviterId: string;
  } | null;
  onAccept: () => void;
  onDecline: () => void;
  isLoading?: boolean;
  error?: string | null;
}

const InvitationModal: React.FC<InvitationModalProps> = ({ 
  invitation, 
  onAccept, 
  onDecline, 
  isLoading = false,
  error = null
}) => {
  useEffect(() => {
    // Log when the component mounts or updates with an invitation
    if (invitation) {
      console.log('InvitationModal rendered with invitation:', invitation, 'isLoading:', isLoading);
    }
  }, [invitation, isLoading]);

  if (!invitation) {
    console.log('InvitationModal not rendering - invitation is null');
    return null;
  }
  
  return (
    <div className="config-modal-overlay" style={{ zIndex: 1000 }}>
      <div className="config-modal" style={{ position: 'relative', zIndex: 1001 }}>
        <h2>Meeting Invitation</h2>
        <div className="invitation-details">
          <p>You've been invited to join a meeting by <strong>{invitation.inviterId}</strong></p>
          <p>Room ID: <strong>{invitation.roomId}</strong></p>
          
          {isLoading && (
            <div className="loading-indicator" style={{
              margin: '15px 0',
              textAlign: 'center',
              color: '#007bff'
            }}>
              <p>Connecting to meeting...</p>
              <div className="spinner" style={{
                width: '30px',
                height: '30px',
                margin: '0 auto',
                border: '4px solid rgba(0, 123, 255, 0.3)',
                borderRadius: '50%',
                borderTop: '4px solid #007bff',
                animation: 'spin 1s linear infinite'
              }}></div>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}
          
          {error && (
            <div className="error-message" style={{
              margin: '10px 0',
              padding: '10px',
              backgroundColor: 'rgba(255, 0, 0, 0.1)',
              color: '#d32f2f',
              borderRadius: '4px'
            }}>
              {error}
            </div>
          )}
        </div>
        
        <div className="form-actions">
          <button 
            type="button" 
            onClick={onDecline}
            className="decline-button"
            disabled={isLoading}
          >
            {isLoading ? 'Cancel' : 'Decline'}
          </button>
          <button 
            type="button" 
            onClick={onAccept}
            className="accept-button"
            disabled={isLoading}
          >
            {isLoading ? 'Connecting...' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvitationModal;
