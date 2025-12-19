import React, { useRef, useEffect, useState } from 'react';

export interface DoodleSpaceProps {
  broadcastDoodleEvent: (event: DrawEvent | ClearEvent) => void;
  doodleEvents: Array<DrawEvent | ClearEvent>;
  width?: number;
  height?: number;
  className?: string;
}

export interface DrawEvent {
  type: 'draw';
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  width: number;
  timestamp?: number;
  source?: 'local' | 'remote';
}

export interface ClearEvent {
  type: 'clear';
  timestamp?: number;
  source?: 'local' | 'remote';
}

const DoodleSpace: React.FC<DoodleSpaceProps> = ({
  broadcastDoodleEvent,
  doodleEvents,
  width = 600,
  height = 400,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [currentColor, setCurrentColor] = useState('#000');
  const [lineWidth, setLineWidth] = useState(2);
  const canvasWidth = width;
  const canvasHeight = height;
  
  const colors = ['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

  // Set up canvas context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set initial canvas state
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Clear canvas with white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Draw incoming doodle events - keep track of processed events
  const processedEventsRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    if (doodleEvents.length === 0) return;
    
    // Find any new events we haven't processed yet
    const newEvents = doodleEvents.filter(event => {
      // Create a unique ID for each event based on its properties
      const eventId = event.type === 'draw'
        ? JSON.stringify({
            type: event.type,
            from: event.from,
            to: event.to,
            timestamp: event.timestamp || Date.now()
          })
        : JSON.stringify({
            type: event.type,
            timestamp: event.timestamp || Date.now()
          });
      
      if (processedEventsRef.current.has(eventId)) {
        return false;
      }
      
      processedEventsRef.current.add(eventId);
      return true;
    });
    
    console.log(`Processing ${newEvents.length} new doodle events`);
    
    // Process all new events
    newEvents.forEach(event => {
      if (event.type === 'draw') {
        ctx.beginPath();
        ctx.moveTo(event.from.x, event.from.y);
        ctx.lineTo(event.to.x, event.to.y);
        ctx.strokeStyle = event.color || '#000';
        ctx.lineWidth = event.width || 2;
        ctx.stroke();
        console.log(`Drew line from (${event.from.x},${event.from.y}) to (${event.to.x},${event.to.y})`);
      } else if (event.type === 'clear') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        console.log('Canvas cleared');
      }
    });
  }, [doodleEvents]);

  // Mouse/touch event handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    lastPoint.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    
    console.log(`Drawing started at (${lastPoint.current.x}, ${lastPoint.current.y})`);
  };

  // Mouse/touch event handlers (improved version that draws locally)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPoint.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const newPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    
    // Draw locally for immediate feedback
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
        ctx.lineTo(newPoint.x, newPoint.y);
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    }
    
    // Create a draw event with a unique timestamp
    const drawEvent: DrawEvent = {
      type: 'draw',
      from: lastPoint.current,
      to: newPoint,
      color: currentColor,
      width: lineWidth,
      timestamp: Date.now(),
      source: 'local'
    };
    
    // Log the event before broadcasting
    console.log('Broadcasting draw event from local canvas:', drawEvent);
    
    // Broadcast draw event
    broadcastDoodleEvent(drawEvent);
    
    lastPoint.current = newPoint;
  };

  const handlePointerUp = () => {
    drawing.current = false;
    lastPoint.current = null;
  };
  
  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    
    // Broadcast clear event
    const clearEvent: ClearEvent = {
      type: 'clear',
      timestamp: Date.now(),
      source: 'local'
    };

    broadcastDoodleEvent(clearEvent);
  };
  
  const handleColorChange = (color: string) => {
    setCurrentColor(color);
  };
  
  const handleLineWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLineWidth(parseInt(e.target.value));
  };

  return (
    <div
      className={className}
      style={{ border: '1px solid #ccc', padding: 8, background: '#fff', maxWidth: canvasWidth }}
    >
      <h3>Collaborative Doodle Space</h3>
      
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {colors.map((color) => (
            <div 
              key={color}
              style={{ 
                width: 24, 
                height: 24, 
                backgroundColor: color, 
                cursor: 'pointer',
                border: color === currentColor ? '2px solid #333' : '1px solid #ccc'
              }}
              onClick={() => handleColorChange(color)}
            />
          ))}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <label>Width:</label>
          <input
            type="range"
            min="1"
            max="10"
            value={lineWidth}
            onChange={handleLineWidthChange}
          />
          <span>{lineWidth}px</span>
        </div>
        
        <button 
          onClick={handleClearCanvas}
          style={{ marginLeft: 'auto' }}
        >
          Clear Canvas
        </button>
      </div>
      
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        style={{ border: '1px solid #333', touchAction: 'none', backgroundColor: '#fff', width: '100%' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
};

export default DoodleSpace;
