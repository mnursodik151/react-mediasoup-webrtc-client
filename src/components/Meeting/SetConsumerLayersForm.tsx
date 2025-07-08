import React, { useState } from 'react';
import { Socket } from 'socket.io-client';

interface SetConsumerLayersFormProps {
  consumerId: string;
  socket: Socket;
}

const SetConsumerLayersForm: React.FC<SetConsumerLayersFormProps> = ({ consumerId, socket }) => {
  const [spatialLayer, setSpatialLayer] = useState('');
  const [temporalLayer, setTemporalLayer] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (spatialLayer === '' || temporalLayer === '') {
      setStatus('All fields required');
      return;
    }
    setStatus('Sending...');
    socket.emit('setConsumerPreferedLayers', {
      consumerId,
      spatialLayer: Number(spatialLayer),
      temporalLayer: Number(temporalLayer),
    });
  };

  React.useEffect(() => {
    const onSet = (data: { consumerId: string; spatialLayer: number; temporalLayer: number }) => {
      if (data.consumerId === consumerId) {
        setStatus(`Set: spatial=${data.spatialLayer}, temporal=${data.temporalLayer}`);
      }
    };
    const onError = (data: { consumerId: string; error: string }) => {
      if (data.consumerId === consumerId) {
        setStatus(`Error: ${data.error}`);
      }
    };
    socket.on('consumerLayersSet', onSet);
    socket.on('consumerLayersError', onError);
    return () => {
      socket.off('consumerLayersSet', onSet);
      socket.off('consumerLayersError', onError);
    };
  }, [socket, consumerId]);

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 8, background: '#222', padding: 8, borderRadius: 6 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          type="number"
          placeholder="Spatial"
          value={spatialLayer}
          onChange={e => setSpatialLayer(e.target.value)}
          min={0}
          style={{ width: 50 }}
        />
        <input
          type="number"
          placeholder="Temporal"
          value={temporalLayer}
          onChange={e => setTemporalLayer(e.target.value)}
          min={0}
          style={{ width: 50 }}
        />
        <button type="submit" style={{ fontSize: 10, padding: '2px 8px' }}>Set</button>
      </div>
      {status && <div style={{ color: status.startsWith('Error') ? 'red' : 'lightgreen', fontSize: 10 }}>{status}</div>}
    </form>
  );
};

export default SetConsumerLayersForm;
