import React, { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { detectEmoteBoxes, removeBackgroundGlobal, applyMagicWand } from './imageProcessor';
import { Wand2, Eraser, Check, Download, UploadCloud, X, RotateCcw, RefreshCw, Undo2, Link } from 'lucide-react';
import './App.css';

export default function App() {
  const [stage, setStage] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Sheet Data
  const [sheetsData, setSheetsData] = useState([]); 
  const [activeSheetIndex, setActiveSheetIndex] = useState(0); 
  
  // Slicing State
  const [activeBoxId, setActiveBoxId] = useState(null);
  const [interaction, setInteraction] = useState({ type: null });
  const containerRef = useRef(null);

  // Emote State
  const [emotes, setEmotes] = useState([]);
  
  // Settings
  const [globalTolerance, setGlobalTolerance] = useState(15);
  const [globalSmoothing, setGlobalSmoothing] = useState(1);
  const [activeTool, setActiveTool] = useState('color');
  const [selectedEmoteId, setSelectedEmoteId] = useState(null);
  const [inspectorBg, setInspectorBg] = useState('transparent');

  // Derived State
  const activeSheet = sheetsData[activeSheetIndex];
  const sheetImg = activeSheet?.img;
  const boxes = activeSheet?.boxes || [];

  // Helper to update boxes for the active sheet
  const setBoxes = (newBoxesOrUpdater) => {
    setSheetsData(prev => prev.map((sheet, i) => {
      if (i !== activeSheetIndex) return sheet;
      const nextBoxes = typeof newBoxesOrUpdater === 'function' ? newBoxesOrUpdater(sheet.boxes) : newBoxesOrUpdater;
      return { ...sheet, boxes: nextBoxes };
    }));
  };

  // --- STAGE 1: UPLOAD ---
  const handleFiles = (files) => {
    if (files.length === 0) return;
    setIsProcessing(true);

    setTimeout(async () => {
      const newSheets = await Promise.all(Array.from(files).map(file => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const autoBoxes = detectEmoteBoxes(img, globalTolerance, 25);
              resolve({
                id: crypto.randomUUID(),
                dataUrl: e.target.result,
                img: img,
                boxes: autoBoxes
              });
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
        });
      }));

      setSheetsData(prev => [...prev, ...newSheets]);
      setIsProcessing(false);
    }, 50);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: handleFiles, accept: {'image/*':[]} });

  useEffect(() => {
    if (stage !== 1) return;
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) files.push(items[i].getAsFile());
      }
      if (files.length > 0) handleFiles(files);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [stage]);

  // --- STAGE 2: DRAGGABLE BOXES ---
  const getNativeCoords = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = sheetImg.width / rect.width;
    const scaleY = sheetImg.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const onContainerPointerDown = (e) => {
    if (e.target.closest('.crop-box')) return;
    const { x, y } = getNativeCoords(e);
    const newBox = { id: crypto.randomUUID(), x, y, w: 0, h: 0 };
    setBoxes([...boxes, newBox]);
    setActiveBoxId(newBox.id);
    setInteraction({ type: 'draw', startX: x, startY: y, initialBox: newBox });
  };

  const onBoxPointerDown = (e, boxId, type) => {
    e.stopPropagation();
    const { x, y } = getNativeCoords(e);
    const box = boxes.find(b => b.id === boxId);
    setActiveBoxId(boxId);
    setInteraction({ type, startX: x, startY: y, initialBox: { ...box } });
  };

  const handlePointerMove = (e) => {
    if (!interaction.type || stage !== 2) return;
    const { x: currentX, y: currentY } = getNativeCoords(e);
    const dx = currentX - interaction.startX;
    const dy = currentY - interaction.startY;
    const { initialBox } = interaction;

    setBoxes(prev => prev.map(box => {
      if (box.id !== activeBoxId) return box;
      let newBox = { ...box };
      if (interaction.type === 'move') {
        newBox.x = initialBox.x + dx;
        newBox.y = initialBox.y + dy;
      } else if (interaction.type === 'resize') {
        newBox.w = Math.max(10, initialBox.w + dx);
        newBox.h = Math.max(10, initialBox.h + dy);
      } else if (interaction.type === 'draw') {
        newBox.x = Math.min(interaction.startX, currentX);
        newBox.y = Math.min(interaction.startY, currentY);
        newBox.w = Math.abs(currentX - interaction.startX);
        newBox.h = Math.abs(currentY - interaction.startY);
      }
      return newBox;
    }));
  };

  const handlePointerUp = () => setInteraction({ type: null });
  const deleteBox = (id) => setBoxes(boxes.filter(b => b.id !== id));
  const clearBoxes = () => setBoxes([]);

  // --- PROCESSING CORE (RECIPE SYSTEM) ---
  const regenerateEmote = async (emote, currentGlobalTol, currentGlobalSm) => {
    const tol = emote.settings.useGlobal ? currentGlobalTol : emote.settings.tolerance;
    const sm = emote.settings.useGlobal ? currentGlobalSm : emote.settings.smoothing;

    // 1. Run Base Background Removal
    const baseCleanUrl = await removeBackgroundGlobal(emote.originalData, tol, sm);

    // 2. Re-play Manual Edits
    if (emote.edits.length === 0) return baseCleanUrl;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = emote.width; c.height = emote.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        emote.edits.forEach(edit => {
          applyMagicWand(c, edit.x, edit.y, tol, edit.tool, sm);
        });
        resolve(c.toDataURL('image/png'));
      };
      img.src = baseCleanUrl;
    });
  };

  const processSlices = async () => {
    const newEmotes = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    sheetsData.forEach((sheet) => {
      const validBoxes = sheet.boxes.filter(b => b.w > 10 && b.h > 10);
      validBoxes.forEach((box) => {
        const pad = 5;
        const x = Math.max(0, box.x - pad);
        const y = Math.max(0, box.y - pad);
        const w = Math.min(sheet.img.width - x, box.w + (pad * 2));
        const h = Math.min(sheet.img.height - y, box.h + (pad * 2));

        canvas.width = w; canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(sheet.img, x, y, w, h, 0, 0, w, h);
        
        const originalData = canvas.toDataURL('image/png');

        newEmotes.push({
          id: box.id,
          originalData: originalData,
          cleanData: originalData, 
          width: w, height: h,
          edits: [], // Stores {x, y, tool} clicks
          settings: { 
            useGlobal: true, 
            tolerance: globalTolerance, 
            smoothing: globalSmoothing 
          },
          tune: { scale: 1, x: 0, y: 0 }
        });
      });
    });

    setEmotes(newEmotes);
    if (newEmotes.length > 0) setSelectedEmoteId(newEmotes[0].id);
    setStage(3);
  };

  // --- STAGE 3: CLEANUP ---

  // Initial Auto-Process on Stage Entry
  useEffect(() => { 
    if (stage === 3) {
      setIsProcessing(true);
      setTimeout(async () => { 
        const updated = await Promise.all(emotes.map(e => regenerateEmote(e, globalTolerance, globalSmoothing)));
        setEmotes(prev => prev.map((e, i) => ({ ...e, cleanData: updated[i] })));
        setIsProcessing(false); 
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]); 

  // Apply Global Defaults to "Synced" Emotes
  const handleApplyGlobal = () => {
    setIsProcessing(true);
    setTimeout(async () => { 
      const updated = await Promise.all(emotes.map(e => {
        if (e.settings.useGlobal) return regenerateEmote(e, globalTolerance, globalSmoothing);
        else return Promise.resolve(e.cleanData); // Skip manually overridden emotes
      }));
      setEmotes(prev => prev.map((e, i) => ({ ...e, cleanData: updated[i] })));
      setIsProcessing(false); 
    }, 50);
  };

  // 1. Update Local Settings State (Does not process yet)
  const handleLocalSettingChange = (setting, value) => {
    if (!selectedEmote) return;
    const updatedEmote = { 
      ...selectedEmote, 
      settings: { ...selectedEmote.settings, [setting]: value, useGlobal: false } 
    };
    setEmotes(emotes.map(e => e.id === selectedEmote.id ? updatedEmote : e));
  };

  // 2. Explicit Apply Button for Local Settings
  const handleApplyLocal = () => {
    if (!selectedEmote) return;
    setIsProcessing(true);
    setTimeout(async () => {
      const newData = await regenerateEmote(selectedEmote, globalTolerance, globalSmoothing);
      setEmotes(prev => prev.map(e => e.id === selectedEmote.id ? { ...e, cleanData: newData } : e));
      setIsProcessing(false);
    }, 50);
  };

  // Toggle Sync
  const toggleSyncGlobal = () => {
    if (!selectedEmote) return;
    const newVal = !selectedEmote.settings.useGlobal;
    
    // If switching to local, inherit current global values as a starting point
    const updatedEmote = {
      ...selectedEmote,
      settings: { 
        ...selectedEmote.settings, 
        useGlobal: newVal,
        tolerance: newVal ? selectedEmote.settings.tolerance : globalTolerance, 
        smoothing: newVal ? selectedEmote.settings.smoothing : globalSmoothing
      }
    };

    setEmotes(emotes.map(e => e.id === selectedEmote.id ? updatedEmote : e));
    
    // If switching BACK to global, auto-regenerate immediately for convenience
    if (newVal) {
      setIsProcessing(true);
      setTimeout(async () => {
        const newData = await regenerateEmote(updatedEmote, globalTolerance, globalSmoothing);
        setEmotes(prev => prev.map(e => e.id === selectedEmote.id ? { ...e, cleanData: newData } : e));
        setIsProcessing(false);
      }, 50);
    }
  };

  // Handle Wand Clicks
  const handleEmoteClickClean = (e, emoteId, canvasRef) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    
    const emoteIndex = emotes.findIndex(em => em.id === emoteId);
    const emote = emotes[emoteIndex];

    const newEdit = { x, y, tool: activeTool };
    const updatedEmote = { ...emote, edits: [...emote.edits, newEdit] };
    
    // Update State
    const newEmotes = [...emotes];
    newEmotes[emoteIndex] = updatedEmote;
    setEmotes(newEmotes);

    // Regenerate Image
    regenerateEmote(updatedEmote, globalTolerance, globalSmoothing).then(newData => {
      setEmotes(prev => prev.map(p => p.id === emote.id ? { ...p, cleanData: newData } : p));
    });
  };

  const undoLastEdit = (id) => {
    const emote = emotes.find(e => e.id === id);
    if (!emote || emote.edits.length === 0) return;

    const updatedEmote = { ...emote, edits: emote.edits.slice(0, -1) };
    setEmotes(emotes.map(e => e.id === id ? updatedEmote : e));
    
    regenerateEmote(updatedEmote, globalTolerance, globalSmoothing).then(newData => {
      setEmotes(prev => prev.map(p => p.id === id ? { ...p, cleanData: newData } : p));
    });
  };

  const resetEmoteEdits = (id) => {
    const emote = emotes.find(e => e.id === id);
    const updatedEmote = { ...emote, edits: [] }; 
    setEmotes(emotes.map(e => e.id === id ? updatedEmote : e));

    regenerateEmote(updatedEmote, globalTolerance, globalSmoothing).then(newData => {
      setEmotes(prev => prev.map(p => p.id === id ? { ...p, cleanData: newData } : p));
    });
  };
  
  const selectedEmote = emotes.find(e => e.id === selectedEmoteId) || emotes[0];
  const updateTune = (id, newTune) => setEmotes(emotes.map(e => e.id === id ? { ...e, tune: newTune } : e));

  // --- EXPORT ---
  const handleExport = async () => {
    const zip = new JSZip();
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < emotes.length; i++) {
      const emote = emotes[i];
      ctx.clearRect(0, 0, 100, 100);

      const img = new Image();
      img.src = emote.cleanData;
      await new Promise(r => img.onload = r);

      const baseScale = Math.min(98 / emote.width, 98 / emote.height);
      const finalScale = baseScale * emote.tune.scale;
      const w = emote.width * finalScale;
      const h = emote.height * finalScale;
      const x = (100 - w) / 2 + emote.tune.x;
      const y = (100 - h) / 2 + emote.tune.y;

      ctx.drawImage(img, x, y, w, h);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      zip.file(`emote_${i + 1}.png`, blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'emotes.zip');
  };

  return (
    <div className="container">
      <header>
        <h1>Emote Extractor Pro</h1>
        <div className="wizard-steps">
          <div className={`step ${stage >= 1 ? 'active' : ''}`}>1. Upload</div>
          <div className={`step ${stage >= 2 ? 'active' : ''}`}>2. Slice</div>
          <div className={`step ${stage >= 3 ? 'active' : ''}`}>3. Clean</div>
          <div className={`step ${stage >= 4 ? 'active' : ''}`}>4. Fit</div>
          <div className={`step ${stage >= 5 ? 'active' : ''}`}>5. Export</div>
        </div>
      </header>

      {stage === 1 && (
        <div className="stage-panel">
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            {isProcessing ? (
               <><RefreshCw className="spin" size={48} color="#888" style={{margin:'0 auto 15px'}}/><p>Analyzing Sheets...</p></>
            ) : (
               <><UploadCloud size={48} color="#888" style={{margin:'0 auto 15px'}}/><p>Drag & drop your sprite sheets here</p><p className="subtext">Or paste from clipboard (Ctrl+V)</p></>
            )}
          </div>
          {sheetsData.length > 0 && (
            <div className="uploaded-sheets-preview">
              <h3>Uploaded Sheets ({sheetsData.length})</h3>
              <div className="sheet-thumbnails">
                {sheetsData.map((sheet, i) => (
                  <div key={sheet.id} className="sheet-thumb">
                    <img src={sheet.dataUrl} alt={`Sheet ${i+1}`} />
                    <button className="btn-remove-sheet" title="Remove Sheet" onClick={() => setSheetsData(sheetsData.filter(s => s.id !== sheet.id))}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <button className="btn-primary" style={{width: '100%', marginTop: '20px'}} onClick={() => { setActiveSheetIndex(0); setStage(2); }}>Proceed to Slicing &gt;</button>
            </div>
          )}
        </div>
      )}

      {stage === 2 && activeSheet && (
        <div className="stage-panel" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
          <div className="toolbar">
            <div style={{display: 'flex', alignItems: 'center', gap: '15px'}}>
              <button className="btn-secondary" onClick={() => setStage(1)}>&lt; Back</button>
              <div><h3>Adjust Crop Boxes</h3><p className="subtext">Drag boxes to move. Drag corners to resize. Click & drag empty space to draw.</p></div>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {sheetsData.length > 1 && (
                <div className="sheet-navigation">
                  <button disabled={activeSheetIndex === 0} onClick={() => setActiveSheetIndex(i => i - 1)}>&lt;</button>
                  <span>Sheet {activeSheetIndex + 1} of {sheetsData.length}</span>
                  <button disabled={activeSheetIndex === sheetsData.length - 1} onClick={() => setActiveSheetIndex(i => i + 1)}>&gt;</button>
                </div>
              )}
              <button className="btn-secondary" onClick={clearBoxes}>Clear Boxes</button>
              <button className="btn-primary" onClick={processSlices}>Confirm All Slices &gt;</button>
            </div>
          </div>
          <div className="slicing-workspace">
            <div className="slicing-canvas-container" ref={containerRef} onPointerDown={onContainerPointerDown} style={{ touchAction: 'none' }}>
              <img src={sheetImg.src} alt="Sheet" className="slicing-bg" draggable="false" />
              {boxes.map(box => (
                <div key={box.id} className={`crop-box ${activeBoxId === box.id ? 'active' : ''}`} onPointerDown={(e) => onBoxPointerDown(e, box.id, 'move')} style={{left: `${(box.x / sheetImg.width) * 100}%`, top: `${(box.y / sheetImg.height) * 100}%`, width: `${(box.w / sheetImg.width) * 100}%`, height: `${(box.h / sheetImg.height) * 100}%`}}>
                  <button className="btn-delete-box" onPointerDown={(e) => { e.stopPropagation(); deleteBox(box.id); }}><X size={12} /></button>
                  <div className="resize-handle" onPointerDown={(e) => onBoxPointerDown(e, box.id, 'resize')} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {stage === 3 && (
        <div className="stage-panel stage3-panel">
          <div className="toolbar">
            <div><h3>Cleanup Extracted Emotes</h3><p className="subtext">Select an emote on the left, edit it on the right.</p></div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-secondary" onClick={() => setStage(2)} disabled={isProcessing}>&lt; Back</button>
              <button className="btn-primary" onClick={() => setStage(4)} disabled={isProcessing}>Tune &amp; Fit &gt;</button>
            </div>
          </div>

          <div className="split-screen" style={{ opacity: isProcessing ? 0.3 : 1, pointerEvents: isProcessing ? 'none' : 'auto' }}>
            <div className="cleanup-gallery">
              <div className="cleanup-thumb-grid">
                {emotes.map(emote => (
                  <div key={emote.id} className={`cleanup-thumb ${selectedEmoteId === emote.id ? 'active' : ''}`} onClick={() => setSelectedEmoteId(emote.id)}>
                    <img src={emote.cleanData} alt="" />
                  </div>
                ))}
              </div>
            </div>

            <div className="cleanup-inspector">
              <div className="inspector-section">
                <h4>Global Defaults</h4>
                <label>Tolerance: {globalTolerance}</label>
                <input type="range" min="0" max="100" value={globalTolerance} onChange={(e)=>setGlobalTolerance(parseInt(e.target.value))} disabled={isProcessing} />
                <label style={{marginTop: '10px'}}>Edge Smoothing: {globalSmoothing}px</label>
                <input type="range" min="0" max="4" value={globalSmoothing} onChange={(e)=>setGlobalSmoothing(parseInt(e.target.value))} disabled={isProcessing} />
                <button className="btn-apply-settings" onClick={handleApplyGlobal} disabled={isProcessing}>
                  {isProcessing ? <><RefreshCw className="spin" size={16} /> Processing...</> : "Apply Defaults to All"}
                </button>
              </div>
              <div className="inspector-divider"></div>

              {selectedEmote && (
                <div className="inspector-section">
                  <div className="local-settings-header">
                     <h4>Selected Emote</h4>
                     <label className="sync-toggle"><input type="checkbox" checked={selectedEmote.settings.useGlobal} onChange={toggleSyncGlobal} />{selectedEmote.settings.useGlobal ? <><Link size={12}/> Sync with Global</> : "Manual Override"}</label>
                  </div>
                  
                  {!selectedEmote.settings.useGlobal && (
                    <div className="local-sliders">
                        <label>Local Tolerance: {selectedEmote.settings.tolerance}</label>
                        <input type="range" min="0" max="100" value={selectedEmote.settings.tolerance} onChange={(e)=>handleLocalSettingChange('tolerance', parseInt(e.target.value))} />
                        <label>Local Smoothing: {selectedEmote.settings.smoothing}</label>
                        <input type="range" min="0" max="4" value={selectedEmote.settings.smoothing} onChange={(e)=>handleLocalSettingChange('smoothing', parseInt(e.target.value))} />
                        <button className="btn-apply-settings" onClick={handleApplyLocal} disabled={isProcessing}>
                           {isProcessing ? <><RefreshCw className="spin" size={16} /> Processing...</> : "Apply Local Changes"}
                        </button>
                    </div>
                  )}

                  <div className="inspector-divider" style={{margin: '15px 0'}}></div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                     <div className="tool-selector" style={{margin: 0}}>
                        <button className={`btn-tool ${activeTool === 'color' ? 'active' : ''}`} onClick={()=>setActiveTool('color')} disabled={isProcessing} title="Bg Wand">
                          <Wand2 size={16}/> <span>Bg Wand</span>
                        </button>
                        <button className={`btn-tool ${activeTool === 'island' ? 'active' : ''}`} onClick={()=>setActiveTool('island')} disabled={isProcessing} title="Object Eraser">
                          <Eraser size={16}/> <span>Object Eraser</span>
                        </button>
                     </div>
                     <div style={{ display: 'flex', gap: '5px' }}>
                        <button className="btn-reset-small" onClick={() => undoLastEdit(selectedEmote.id)} title="Undo last change" disabled={selectedEmote.edits.length === 0}>
                            <Undo2 size={14} /> <span>Undo</span>
                        </button>
                        <button className="btn-reset-small" onClick={() => resetEmoteEdits(selectedEmote.id)} title="Reset all changes">
                            <RotateCcw size={14} /> <span>Reset</span>
                        </button>
                     </div>
                  </div>
                  
                  <div className="canvas-header">
                     <span className="hint" style={{margin: 0}}>{activeTool === 'color' ? "Click trapped white spaces." : "Click stray objects."}</span>
                     <div className="bg-toggles">
                       <button className={`bg-toggle-btn ${inspectorBg === 'transparent' ? 'active' : ''}`} onClick={() => setInspectorBg('transparent')}>🏁</button>
                       <button className={`bg-toggle-btn ${inspectorBg === '#000000' ? 'active' : ''}`} onClick={() => setInspectorBg('#000000')} style={{background: '#000'}}></button>
                       <button className={`bg-toggle-btn ${inspectorBg === '#ffffff' ? 'active' : ''}`} onClick={() => setInspectorBg('#ffffff')} style={{background: '#fff'}}></button>
                       <button className={`bg-toggle-btn ${inspectorBg === '#ff00ff' ? 'active' : ''}`} onClick={() => setInspectorBg('#ff00ff')} style={{background: '#ff00ff'}}></button>
                       <button className={`bg-toggle-btn ${inspectorBg === '#00ff00' ? 'active' : ''}`} onClick={() => setInspectorBg('#00ff00')} style={{background: '#00ff00'}}></button>
                     </div>
                  </div>

                  <div className={`inspector-canvas-wrapper ${inspectorBg === 'transparent' ? 'bg-checker' : ''}`} style={{ backgroundColor: inspectorBg !== 'transparent' ? inspectorBg : 'transparent' }}>
                     <canvas width={selectedEmote.width} height={selectedEmote.height} className={`inspector-canvas ${activeTool === 'color' ? 'cursor-wand' : 'cursor-eraser'}`} ref={(c) => { if(c) { const ctx = c.getContext('2d'); const img = new Image(); img.onload = () => { ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img,0,0); }; img.src = selectedEmote.cleanData; }}} onClick={(e) => handleEmoteClickClean(e, selectedEmote.id, {current: e.target})} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {stage === 4 && (
        <div className="stage-panel">
          <div className="toolbar">
            <h3>Nudge & Fit (100x100)</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-secondary" onClick={() => setStage(3)}>&lt; Back</button>
              <button className="btn-primary" onClick={() => setStage(5)}>Review &amp; Export &gt;</button>
            </div>
          </div>
          <div className="grid">
            {emotes.map(emote => {
              const baseScale = Math.min(98 / emote.width, 98 / emote.height);
              const displayScale = baseScale * emote.tune.scale;
              return (
                <div key={emote.id} className="card">
                  <div className="preview-box">
                    <div className="preview-canvas bg-checker"><div className="canvas-scaler"><img src={emote.cleanData} style={{ transform: `translate(calc(-50% + ${emote.tune.x}px), calc(-50% + ${emote.tune.y}px)) scale(${displayScale})`}} alt="" /></div></div>
                  </div>
                  <div className="controls">
                    <label>Scale <input type="range" min="0.5" max="2" step="0.05" value={emote.tune.scale} onChange={(e) => updateTune(emote.id, {...emote.tune, scale: parseFloat(e.target.value)})} /></label>
                    <label>Offset X <input type="range" min="-50" max="50" step="1" value={emote.tune.x} onChange={(e) => updateTune(emote.id, {...emote.tune, x: parseInt(e.target.value)})} /></label>
                    <label>Offset Y <input type="range" min="-50" max="50" step="1" value={emote.tune.y} onChange={(e) => updateTune(emote.id, {...emote.tune, y: parseInt(e.target.value)})} /></label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stage === 5 && (
        <div className="stage-panel final-panel">
          <Check size={64} color="#10b981" style={{marginBottom: '20px'}}/>
          <h2>Ready to Export {emotes.length} Emotes</h2>
          <p className="subtext">All emotes have been perfectly fitted to a 100x100 transparent canvas.</p>
          <div className="final-gallery-grid bg-checker">
            {emotes.map(emote => {
              const baseScale = Math.min(98 / emote.width, 98 / emote.height);
              const displayScale = baseScale * emote.tune.scale;
              return (
                <div key={`final_${emote.id}`} className="final-emote-item"><img src={emote.cleanData} style={{ transform: `translate(calc(-50% + ${emote.tune.x}px), calc(-50% + ${emote.tune.y}px)) scale(${displayScale})`}} alt="" /></div>
              );
            })}
          </div>
          <div style={{marginTop: '30px', display: 'flex', gap: '20px', justifyContent: 'center'}}>
            <button className="btn-secondary" onClick={() => setStage(4)}>&lt; Back to Tuning</button>
            <button className="btn-export-large" onClick={handleExport}><Download size={20}/> Download .ZIP</button>
          </div>
        </div>
      )}
    </div>
  );
}