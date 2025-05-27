import React from 'react';

interface InviteModalProps {
  inviteUserIds: string;
  setInviteUserIds: (value: string) => void;
  invitationStatus: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

const InviteModal: React.FC<InviteModalProps> = ({
  inviteUserIds,
  setInviteUserIds,
  invitationStatus,
  onClose,
  onSubmit
}) => (
  <div className="config-modal-overlay">
    <div className="config-modal">
      <h2>Invite Participants</h2>
      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label>User ID(s):</label>
          <input 
            type="text" 
            value={inviteUserIds}
            onChange={(e) => setInviteUserIds(e.target.value)}
            placeholder="Enter user IDs separated by commas"
            required
          />
          <small>Example: user1,user2,user3</small>
        </div>
        {invitationStatus && (
          <div className={`invitation-status ${invitationStatus.includes('Error') ? 'error' : 'success'}`}>
            {invitationStatus}
          </div>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Send Invites</button>
        </div>
      </form>
    </div>
  </div>
);

export default InviteModal;
