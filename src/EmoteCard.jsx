import React from 'react';
import { Trash2, RotateCcw } from 'lucide-react';

export default function EmoteCard({ emote, updateTune, toggleIgnore }) {
  const { id, dataUrl, tune, ignored } = emote;

  const baseScale = Math.min(90 / emote.width, 90 / emote.height);
  const finalScale = baseScale * tune.scale;

  const handleTune = (key, value) => updateTune(id, { ...tune, [key]: parseFloat(value) });
  const resetTune = () => updateTune(id, { scale: 1, x: 0, y: 0 });

  return (
    <div className={`card ${ignored ? 'ignored' : ''}`}>
      <div className="preview-box">
        <div className="preview-canvas">
          <div className="canvas-scaler">
            <img 
              src={dataUrl} 
              alt="Emote" 
              style={{
                transform: `translate(calc(-50% + ${tune.x}px), calc(-50% + ${tune.y}px)) scale(${finalScale})`,
              }}
            />
          </div>
        </div>
        
        <div className="actions">
          <button onClick={() => toggleIgnore(id)} className="btn-icon" title="Ignore/Delete">
            <Trash2 size={18} color={ignored ? 'red' : 'gray'} />
          </button>
        </div>
      </div>

      <div className="controls">
        <label>
          Scale ({tune.scale.toFixed(2)})
          <input type="range" min="0.5" max="2" step="0.05" value={tune.scale} onChange={(e) => handleTune('scale', e.target.value)} disabled={ignored} />
        </label>
        <label>
          Offset X ({tune.x}px)
          <input type="range" min="-50" max="50" step="1" value={tune.x} onChange={(e) => handleTune('x', e.target.value)} disabled={ignored} />
        </label>
        <label>
          Offset Y ({tune.y}px)
          <input type="range" min="-50" max="50" step="1" value={tune.y} onChange={(e) => handleTune('y', e.target.value)} disabled={ignored} />
        </label>
        <button onClick={resetTune} disabled={ignored} className="btn-reset">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </div>
  );
}