import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const [file, setFile] = useState(null);
  const [history, setHistory] = useState([]);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  // Load transmission logs from localStorage on mount
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('nebula_transfer_history') || '[]');
    setHistory(saved);
  }, []);

  // Handle Drag & Drop
  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    validateAndSetFile(droppedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  // Handle manual file selection
  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    validateAndSetFile(selectedFile);
  };

  // Ensure file is under 50MB (as per MVP requirements)
  const validateAndSetFile = (selectedFile) => {
    if (selectedFile) {
      if (selectedFile.size > 50 * 1024 * 1024) {
        alert("File size exceeds the 50MB limit for local space-transmissions.");
        return;
      }
      setFile(selectedFile);
    }
  };

  const saveToHistory = (fileName, fileSize, roomLink, role) => {
    const currentHistory = JSON.parse(localStorage.getItem('nebula_transfer_history') || '[]');
    const newRecord = {
      id: Math.random().toString(36).substring(2, 9),
      name: fileName,
      size: fileSize,
      link: roomLink,
      role: role,
      timestamp: Date.now()
    };
    // Keep last 5 transmissions
    const updated = [newRecord, ...currentHistory].slice(0, 5);
    localStorage.setItem('nebula_transfer_history', JSON.stringify(updated));
    setHistory(updated);
  };

  // Generate a random room ID and a secret encryption key that stays in the URL hash
  const generateLink = () => {
    if (!file) return;
    const roomId = Math.random().toString(36).substring(2, 9);
    const secretKey = Math.random().toString(36).substring(2, 15);
    const roomPath = `/room/${roomId}#${secretKey}`;
    
    // Save to history before navigating
    saveToHistory(file.name, file.size, roomPath, 'sender');
    
    navigate(roomPath, { state: { file } });
  };

  const clearHistory = (e) => {
    e.stopPropagation();
    localStorage.removeItem('nebula_transfer_history');
    setHistory([]);
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center select-none relative">
      {/* Decorative stars / nebula backdrop */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full filter blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full filter blur-3xl pointer-events-none"></div>

      <div className="max-w-2xl w-full z-10">
        {/* Animated Brand Header */}
        <div className="mb-8 animate-[float_4s_infinite_ease-in-out]">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/40 border border-cyan-800/30 text-xs text-neon-cyan font-mono mb-4">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            P2P ORBITAL BRIDGE ACTIVE
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-3 bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent orbitron">
            NEBULA SHARE
          </h1>
          <p className="text-gray-400 text-sm md:text-base max-w-md mx-auto font-light">
            Zero-Knowledge, encrypted file transmissions. Direct client-to-client bridge bypasses server interception.
          </p>
        </div>

        {/* Portal Drag and Drop Zone */}
        <div 
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current.click()}
          className="portal-zone w-full max-w-lg mx-auto h-80 border border-dashed border-cyan-500/30 rounded-3xl flex flex-col items-center justify-center cursor-pointer glass-panel hover:border-cyan-400/60 transition-all group duration-500"
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            className="hidden" 
          />

          {/* Decorative rotating orbital rings inside the portal */}
          <div className="portal-ring-1 w-72 h-72"></div>
          <div className="portal-ring-2 w-60 h-60"></div>
          
          <div className="z-10 flex flex-col items-center p-6 pointer-events-none">
            {file ? (
              <div className="animate-[float_3s_infinite_ease-in-out] text-center">
                <div className="w-20 h-20 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-4 mx-auto shadow-lg shadow-cyan-500/10">
                  <svg className="w-10 h-10 text-neon-cyan animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="text-cyan-200 font-semibold text-lg max-w-xs truncate">{file.name}</div>
                <div className="text-xs text-gray-400 font-mono mt-1">
                  SIZE: {formatSize(file.size)}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-cyan-400/40 group-hover:bg-cyan-500/5 transition-all duration-500">
                  <svg className="w-10 h-10 text-neon-purple group-hover:text-neon-cyan transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-gray-200 font-medium tracking-wide">Initialize Transfer Node</p>
                <p className="text-gray-400 text-xs mt-2 font-mono">DRAG & DROP OR TAP TO OPEN SIGNAL</p>
                <p className="text-[10px] text-cyan-500/60 font-mono mt-4">MAX SECURE SIZE: 50MB</p>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="h-24 flex items-center justify-center">
          {file && (
            <button 
              onClick={generateLink}
              className="px-10 py-3.5 bg-neon-gradient text-white rounded-full font-bold text-sm tracking-widest bg-neon-gradient-hover cursor-pointer border border-cyan-400/30 hover:scale-105 active:scale-95 transition-all shadow-lg font-mono orbitron"
            >
              GENERATE QUANTUM LINK
            </button>
          )}
        </div>

        {/* Transmission Logs (Local History) */}
        {history.length > 0 && (
          <div className="mt-6 max-w-lg mx-auto text-left glass-panel p-6 rounded-2xl border border-gray-800">
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-bold tracking-widest text-neon-purple font-mono uppercase">
                📜 TRANSMISSION LOGS
              </span>
              <button 
                onClick={clearHistory}
                className="text-[10px] font-mono text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                [WIPE LOGS]
              </button>
            </div>
            
            <div className="space-y-3 font-mono text-xs">
              {history.map((item) => (
                <div 
                  key={item.id}
                  onClick={() => navigate(item.link)}
                  className="flex items-center justify-between p-3 rounded-lg bg-black/30 border border-gray-800 hover:border-cyan-500/20 cursor-pointer transition-colors animate-fade-in"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${item.role === 'sender' ? 'bg-cyan-400 animate-pulse' : 'bg-purple-400 animate-pulse'}`}></span>
                    <span className="text-gray-300 truncate max-w-[180px] md:max-w-[240px]">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-gray-500 text-[10px]">
                    <span>{formatSize(item.size)}</span>
                    <span className="text-[9px] bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded text-gray-400 uppercase">
                      {item.role}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}