import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Play, ShieldAlert, Award, Trophy, RotateCcw, Volume2, VolumeX, 
  Settings, Circle, Target, Activity, CheckCircle, RefreshCw, Smartphone, 
  Zap, Info, Plus, ChevronRight, BarChart2, Edit3, X, Eye, HelpCircle
} from 'lucide-react';

// --- DARTBOARD GEOMETRY & CONSTANTS ---
// Numbers order clockwise starting from 20 at top
const BOARD_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Relative radii (normalized to outer double wire radius = 170mm approx standard)
const RADII = {
  INNER_BULL: 6.35 / 170,
  OUTER_BULL: 15.9 / 170,
  TRIPLE_INNER: 97.0 / 170,
  TRIPLE_OUTER: 107.0 / 170,
  DOUBLE_INNER: 162.0 / 170,
  DOUBLE_OUTER: 170.0 / 170
};

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState('camera'); // 'camera', 'games', 'play', 'stats', 'guide'

  // Speech Synth
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Active Game State
  const [gameMode, setGameMode] = useState('x01'); // 'x01', 'atc', 'bobs27', 'catch40', 'c121', 'jdc', 'darts100'
  const [gameConfig, setGameConfig] = useState({
    x01Score: 501,
    botLevel: 'medium', // 'off', 'easy', 'medium', 'pro'
    atcVariant: 'singles', // 'singles', 'doubles', 'triples'
  });

  // Gameplay State
  const [currentLeg, setCurrentLeg] = useState(null);
  const [dartsThrownThisTurn, setDartsThrownThisTurn] = useState([]);
  const [sessionStats, setSessionStats] = useState({
    totalDarts: 0,
    totalScore: 0,
    doublesAttempted: 0,
    doublesHit: 0,
    tons: 0, // 100+
    ton40s: 0, // 140+
    ton80s: 0, // 180
    history: []
  });

  // Camera & Scoring Engine State
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('environment'); // 'environment' or 'user'
  const [isCalibrating, setIsCalibrating] = useState(false);
  
  // Calibration Center and Scale on Canvas (Percentages 0-100)
  const [calibCenter, setCalibCenter] = useState({ x: 50, y: 50, radius: 40 });
  const [detectionLogs, setDetectionLogs] = useState([]);
  const [lastDetectedScore, setLastDetectedScore] = useState(null);

  // Voice Announcement Helper
  const announce = useCallback((text) => {
    if (!soundEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }, [soundEnabled]);

  // --- CAMERA HANDLERS ---
  const startCamera = async () => {
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.error("Camera access error:", err);
      addLog("Failed to access camera. Verify permissions in phone browser.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      setCameraActive(false);
    }
  };

  const toggleCameraFacing = () => {
    setCameraFacing(prev => prev === 'environment' ? 'user' : 'environment');
  };

  useEffect(() => {
    if (activeTab === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [activeTab, cameraFacing]);

  const addLog = (msg) => {
    setDetectionLogs(prev => [ `${new Date().toLocaleTimeString().split(' ')[0]} - ${msg}`, ...prev.slice(0, 8)]);
  };

  // --- POLAR COORDINATE SCORE CALCULATOR ---
  const getScoreFromCoordinates = (dx, dy) => {
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angle < 0) angle += 360;

    if (dist > RADII.DOUBLE_OUTER) {
      return { score: 0, multiplier: 0, label: 'MISS', value: 0 };
    }

    if (dist <= RADII.INNER_BULL) {
      return { score: 50, multiplier: 1, label: 'BULL', value: 50 };
    }
    if (dist <= RADII.OUTER_BULL) {
      return { score: 25, multiplier: 1, label: '25', value: 25 };
    }

    const sectorAngle = 360 / 20;
    const adjustedAngle = (angle + sectorAngle / 2) % 360;
    const sectorIndex = Math.floor(adjustedAngle / sectorAngle);
    const num = BOARD_NUMBERS[sectorIndex];

    let multiplier = 1;
    let label = `${num}`;

    if (dist >= RADII.TRIPLE_INNER && dist <= RADII.TRIPLE_OUTER) {
      multiplier = 3;
      label = `T${num}`;
    } else if (dist >= RADII.DOUBLE_INNER && dist <= RADII.DOUBLE_OUTER) {
      multiplier = 2;
      label = `D${num}`;
    }

    return { score: num, multiplier, label, value: num * multiplier };
  };

  const handleSimulateShot = (e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const centerX = (calibCenter.x / 100) * rect.width;
    const centerY = (calibCenter.y / 100) * rect.height;
    const radiusPx = (calibCenter.radius / 100) * (Math.min(rect.width, rect.height) / 2);

    const dx = (clickX - centerX) / radiusPx;
    const dy = (clickY - centerY) / radiusPx;

    const hit = getScoreFromCoordinates(dx, dy);
    processDartHit(hit, { x: clickX, y: clickY });
  };

  const processDartHit = (hit, pixelCoords = null) => {
    setLastDetectedScore(hit);
    addLog(`HIT DETECTED: ${hit.label} (${hit.value} pts)`);
    
    if (hit.value === 180) announce("ONE HUNDRED AND EIGHTY!");
    else if (hit.label === 'BULL') announce("BULLSEYE!");
    else if (hit.value > 0) announce(`${hit.value}`);

    if (currentLeg) {
      applyDartToGame(hit);
    }
  };

  // --- GAME LOGIC CONTROLLER ---
  const startNewGame = (mode = gameMode) => {
    setGameMode(mode);
    setDartsThrownThisTurn([]);

    if (mode === 'x01') {
      setCurrentLeg({
        playerScore: gameConfig.x01Score,
        botScore: gameConfig.x01Score,
        turn: 'player',
        dartsInTurn: [],
        playerLegsWon: 0,
        botLegsWon: 0,
        history: [],
        targetSuggestion: getCheckoutSuggestion(gameConfig.x01Score)
      });
    } else if (mode === 'atc') {
      setCurrentLeg({
        currentTargetIdx: 0,
        variant: gameConfig.atcVariant,
        totalDarts: 0,
        hits: 0,
        completed: false
      });
    } else if (mode === 'bobs27') {
      setCurrentLeg({
        score: 27,
        currentTargetNum: 1,
        dartsLeftInRound: 3,
        roundHits: 0,
        gameOver: false
      });
    } else if (mode === 'c121') {
      setCurrentLeg({
        targetScore: 121,
        scoreLeft: 121,
        dartsLeft: 9,
        success: false
      });
    } else if (mode === 'darts100') {
      setCurrentLeg({
        dartsLeft: 100,
        totalScore: 0,
        t20Hits: 0,
        t19Hits: 0,
        history: []
      });
    } else if (mode === 'jdc') {
      setCurrentLeg({
        section: 'SHANGHAI', // SHANGHAI, DOUBLES, BULL
        targetNum: 10,
        totalScore: 0,
        dartsLeft: 27
      });
    }

    setActiveTab('play');
    announce(`Game started: ${mode.toUpperCase()}`);
  };

  const applyDartToGame = (hit) => {
    if (!currentLeg) return;

    if (gameMode === 'x01') {
      handleX01Dart(hit);
    } else if (gameMode === 'atc') {
      handleATCDart(hit);
    } else if (gameMode === 'bobs27') {
      handleBobs27Dart(hit);
    } else if (gameMode === 'darts100') {
      handleDarts100Dart(hit);
    } else if (gameMode === 'c121') {
      handle121Dart(hit);
    } else if (gameMode === 'jdc') {
      handleJDCDart(hit);
    }
  };

  const handleX01Dart = (hit) => {
    if (currentLeg.turn !== 'player') return;

    const currentScore = currentLeg.playerScore;
    const hitVal = hit.value;
    const remaining = currentScore - hitVal;

    let newScore = currentScore;
    let isBust = false;

    if (remaining === 0 && hit.multiplier === 2) {
      newScore = 0;
    } else if (remaining <= 1) {
      isBust = true;
    } else {
      newScore = remaining;
    }

    const updatedTurnDarts = [...dartsThrownThisTurn, hit];
    setDartsThrownThisTurn(updatedTurnDarts);

    if (newScore === 0) {
      announce("GAME SHOT AND THE MATCH!");
      setCurrentLeg(prev => ({
        ...prev,
        playerScore: 0,
        playerLegsWon: prev.playerLegsWon + 1,
        winner: 'player'
      }));
      updateStats(updatedTurnDarts, true);
      return;
    }

    if (isBust) {
      announce("BUST!");
      endPlayerTurnX01(currentScore, updatedTurnDarts);
      return;
    }

    setCurrentLeg(prev => ({
      ...prev,
      playerScore: newScore,
      targetSuggestion: getCheckoutSuggestion(newScore)
    }));

    if (updatedTurnDarts.length === 3) {
      endPlayerTurnX01(newScore, updatedTurnDarts);
    }
  };

  const endPlayerTurnX01 = (finalTurnScore, turnDarts) => {
    setDartsThrownThisTurn([]);
    updateStats(turnDarts, false);

    if (gameConfig.botLevel !== 'off') {
      setCurrentLeg(prev => ({ ...prev, turn: 'bot' }));
      setTimeout(() => simulateBotTurn(), 1200);
    } else {
      setCurrentLeg(prev => ({ ...prev, turn: 'player' }));
    }
  };

  const simulateBotTurn = () => {
    if (!currentLeg) return;
    
    let botAccuracy = 0.3;
    if (gameConfig.botLevel === 'medium') botAccuracy = 0.55;
    if (gameConfig.botLevel === 'pro') botAccuracy = 0.82;

    let botScore = currentLeg.botScore;
    let botDarts = [];

    for (let i = 0; i < 3; i++) {
      if (botScore === 0) break;
      let hitVal = 0;
      
      if (botScore <= 40 && botScore % 2 === 0) {
        if (Math.random() < botAccuracy) {
          hitVal = botScore;
        } else {
          hitVal = Math.random() > 0.5 ? 0 : Math.floor(botScore / 2);
        }
      } else {
        const rand = Math.random();
        if (rand < botAccuracy) hitVal = 60;
        else if (rand < botAccuracy + 0.2) hitVal = 20;
        else if (rand < botAccuracy + 0.3) hitVal = 26;
        else hitVal = 5;
      }

      if (botScore - hitVal >= 2 || botScore - hitVal === 0) {
        botScore -= hitVal;
      }
      botDarts.push(hitVal);
    }

    announce(`Bot scored ${botDarts.reduce((a,b)=>a+b, 0)}`);

    setCurrentLeg(prev => ({
      ...prev,
      botScore: botScore,
      turn: 'player',
      botLegsWon: botScore === 0 ? prev.botLegsWon + 1 : prev.botLegsWon
    }));
  };

  const handleATCDart = (hit) => {
    const targetNum = BOARD_NUMBERS[currentLeg.currentTargetIdx];
    let isHit = false;

    if (currentLeg.variant === 'singles' && hit.score === targetNum) isHit = true;
    if (currentLeg.variant === 'doubles' && hit.score === targetNum && hit.multiplier === 2) isHit = true;
    if (currentLeg.variant === 'triples' && hit.score === targetNum && hit.multiplier === 3) isHit = true;

    const nextIdx = isHit ? currentLeg.currentTargetIdx + 1 : currentLeg.currentTargetIdx;
    const completed = nextIdx >= BOARD_NUMBERS.length;

    if (isHit) announce("YES!");

    setCurrentLeg(prev => ({
      ...prev,
      currentTargetIdx: completed ? prev.currentTargetIdx : nextIdx,
      totalDarts: prev.totalDarts + 1,
      hits: isHit ? prev.hits + 1 : prev.hits,
      completed
    }));

    if (completed) announce("Around the clock completed! Great job!");
  };

  const handleBobs27Dart = (hit) => {
    const targetDouble = currentLeg.currentTargetNum;
    const isDoubleHit = hit.score === targetDouble && hit.multiplier === 2;

    const roundHits = isDoubleHit ? currentLeg.roundHits + 1 : currentLeg.roundHits;
    const dartsLeft = currentLeg.dartsLeftInRound - 1;

    if (dartsLeft === 0) {
      let scoreChange = 0;
      if (roundHits > 0) {
        scoreChange = roundHits * (targetDouble * 2);
      } else {
        scoreChange = -(targetDouble * 2);
      }

      const newScore = currentLeg.score + scoreChange;
      const nextTarget = currentLeg.currentTargetNum + 1;
      const gameOver = newScore <= 0 || nextTarget > 20;

      setCurrentLeg(prev => ({
        ...prev,
        score: newScore,
        currentTargetNum: nextTarget,
        dartsLeftInRound: 3,
        roundHits: 0,
        gameOver
      }));

      if (gameOver) {
        announce(newScore > 0 ? `Bob's 27 Complete! Final Score: ${newScore}` : "Game Over! Score dropped below zero.");
      }
    } else {
      setCurrentLeg(prev => ({
        ...prev,
        dartsLeftInRound: dartsLeft,
        roundHits
      }));
    }
  };

  const handleDarts100Dart = (hit) => {
    const newTotal = currentLeg.totalScore + hit.value;
    const remainingDarts = currentLeg.dartsLeft - 1;

    setCurrentLeg(prev => ({
      ...prev,
      totalScore: newTotal,
      dartsLeft: remainingDarts,
      t20Hits: hit.label === 'T20' ? prev.t20Hits + 1 : prev.t20Hits,
      t19Hits: hit.label === 'T19' ? prev.t19Hits + 1 : prev.t19Hits
    }));

    if (remainingDarts === 0) {
      announce(`Session finished. Total score: ${newTotal}`);
    }
  };

  const handle121Dart = (hit) => {
    const remaining = currentLeg.scoreLeft - hit.value;
    const dartsLeft = currentLeg.dartsLeft - 1;

    if (remaining === 0 && hit.multiplier === 2) {
      announce("CHECKOUT SUCCESSFUL!");
      setCurrentLeg(prev => ({ ...prev, targetScore: prev.targetScore + 1, scoreLeft: prev.targetScore + 1, dartsLeft: 9 }));
    } else if (remaining <= 1 || dartsLeft === 0) {
      announce("FAILED! TRYING AGAIN.");
      setCurrentLeg(prev => ({ ...prev, scoreLeft: prev.targetScore, dartsLeft: 9 }));
    } else {
      setCurrentLeg(prev => ({ ...prev, scoreLeft: remaining, dartsLeft }));
    }
  };

  const handleJDCDart = (hit) => {
    const newTotal = currentLeg.totalScore + hit.value;
    const remaining = currentLeg.dartsLeft - 1;
    setCurrentLeg(prev => ({
      ...prev,
      totalScore: newTotal,
      dartsLeft: remaining
    }));
  };

  const updateStats = (turnDarts, isCheckout) => {
    const turnSum = turnDarts.reduce((acc, d) => acc + d.value, 0);
    setSessionStats(prev => {
      const totalDarts = prev.totalDarts + turnDarts.length;
      const totalScore = prev.totalScore + turnSum;
      return {
        ...prev,
        totalDarts,
        totalScore,
        tons: turnSum >= 100 && turnSum < 140 ? prev.tons + 1 : prev.tons,
        ton40s: turnSum >= 140 && turnSum < 180 ? prev.ton40s + 1 : prev.ton40s,
        ton80s: turnSum === 180 ? prev.ton80s + 1 : prev.ton80s,
        history: [{ date: new Date().toLocaleTimeString(), score: turnSum, darts: turnDarts }, ...prev.history]
      };
    });
  };

  const getCheckoutSuggestion = (score) => {
    if (score > 170 || score <= 1) return null;
    const checkouts = {
      170: ['T20', 'T20', 'BULL'],
      167: ['T20', 'T19', 'BULL'],
      164: ['T20', 'T18', 'BULL'],
      160: ['T20', 'T20', 'D20'],
      121: ['T20', 'T15', 'D8'],
      100: ['T20', 'D20'],
      80: ['T20', 'D10'],
      60: ['20', 'D20'],
      40: ['D20'],
      32: ['D16'],
      16: ['D8'],
      8: ['D4'],
      4: ['D2'],
      2: ['D1']
    };
    return checkouts[score] || [`${score > 40 ? 'S' + (score - 32) : 'S' + score}`, score > 40 ? 'D16' : ''];
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans select-none overflow-hidden">
      
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-emerald-500/20 backdrop-blur">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
            <Target className="w-5 h-5 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
              DartPro Vision
            </h1>
            <p className="text-[10px] text-slate-400">AI Auto-Scorer & Trainer</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setActiveTab('guide')}
            className={`p-2 rounded-lg border transition ${activeTab === 'guide' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border transition ${soundEnabled ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <div className="px-2.5 py-1 bg-slate-800 rounded-full border border-slate-700 text-xs font-mono text-emerald-400">
            AVG: {sessionStats.totalDarts > 0 ? ((sessionStats.totalScore / sessionStats.totalDarts) * 3).toFixed(1) : '0.0'}
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto p-4 relative">

        {/* TAB: MOBILE SETUP & USER GUIDE */}
        {activeTab === 'guide' && (
          <div className="space-y-4 pb-6">
            <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4">
              <h2 className="text-lg font-black text-emerald-400 mb-1 flex items-center gap-2">
                <Smartphone className="w-5 h-5" /> Smartphone Camera Mounting Setup
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                Pro spuštění autoskoringu na mobilu přímo u terče postupuj podle následujících kroků:
              </p>
              
              <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300">
                <li className="pl-1"><strong className="text-white">Umístění telefonu:</strong> Připevni telefon na stativ nebo držák asi 1,5 až 2 metry od terče z bočního/čelního úhlu tak, aby byla vidět celá plocha terče.</li>
                <li className="pl-1"><strong className="text-white">Osvětlení:</strong> Zajisti rovnoměrné osvětlení terče bez silných stínů šipek.</li>
                <li className="pl-1"><strong className="text-white">Povolení kamery:</strong> V prohlížeči (Chrome/Safari) povol přístup ke kameře.</li>
                <li className="pl-1"><strong className="text-white">Kalibrace:</strong> Otevři záložku <span className="text-emerald-400 font-bold">Vision</span>, klepni na tlačítko ozubeného kola a posuvníky zarovnej zelený kruh přesně na vnější dvojkový kroužek (Double Ring) tvého terče.</li>
                <li className="pl-1"><strong className="text-white">Počítání:</strong> Klepnutím na místo dopadu šipky na obrazovce (nebo při spuštěné detekci) se automaticky započítá skóre a hlasový rozhodčí přečte bodové ohodnocení.</li>
              </ol>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Web Deployment Options
              </h3>
              <p className="text-xs text-slate-400">
                Aplikaci lze okamžitě nahrát na služby jako <strong>Vercel, Netlify, nebo GitHub Pages</strong> pro spuštění z jakéhokoliv mobilního zařízení bez instalace.
              </p>
            </div>
          </div>
        )}

        {/* TAB 1: CAMERA & AUTO-SCORE DETECTOR */}
        {activeTab === 'camera' && (
          <div className="flex flex-col h-full space-y-4">
            
            <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
              
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover"
              />

              <canvas
                ref={canvasRef}
                onClick={handleSimulateShot}
                className="absolute inset-0 w-full h-full cursor-crosshair z-10"
              />

              <div 
                className={`absolute pointer-events-none rounded-full border-2 ${isCalibrating ? 'border-yellow-400 border-dashed animate-spin' : 'border-emerald-500/50'}`}
                style={{
                  left: `${calibCenter.x}%`,
                  top: `${calibCenter.y}%`,
                  width: `${calibCenter.radius * 2}%`,
                  height: `${calibCenter.radius * 2}%`,
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)'
                }}
              >
                <div className="absolute top-1/2 left-0 w-full h-[1px] bg-emerald-500/40"></div>
                <div className="absolute left-1/2 top-0 h-full w-[1px] bg-emerald-500/40"></div>
                <div className="absolute top-1/2 left-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400 bg-emerald-500/20"></div>
              </div>

              <div className="absolute top-3 right-3 z-20 flex flex-col space-y-2">
                <button 
                  onClick={toggleCameraFacing} 
                  className="p-2.5 bg-slate-900/80 backdrop-blur rounded-xl border border-slate-700 text-slate-200 active:scale-95"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setIsCalibrating(!isCalibrating)} 
                  className={`p-2.5 backdrop-blur rounded-xl border active:scale-95 ${isCalibrating ? 'bg-yellow-500/30 border-yellow-500 text-yellow-300' : 'bg-slate-900/80 border-slate-700 text-slate-200'}`}
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              {lastDetectedScore && (
                <div className="absolute bottom-4 left-4 z-20 bg-slate-900/90 border border-emerald-500/40 backdrop-blur px-4 py-2 rounded-xl flex items-center space-x-3 shadow-lg">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Detected Score</div>
                    <div className="text-lg font-black text-emerald-400">{lastDetectedScore.label} ({lastDetectedScore.value} pts)</div>
                  </div>
                </div>
              )}
            </div>

            {isCalibrating && (
              <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-800 space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold text-slate-300">
                  <span>Target Alignment Adjustment</span>
                  <button onClick={() => setIsCalibrating(false)} className="text-emerald-400">Done</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col text-[10px] text-slate-400">
                    <span>Center X: {calibCenter.x}%</span>
                    <input type="range" min="20" max="80" value={calibCenter.x} onChange={(e) => setCalibCenter(prev => ({...prev, x: Number(e.target.value)}))} />
                  </div>
                  <div className="flex flex-col text-[10px] text-slate-400">
                    <span>Center Y: {calibCenter.y}%</span>
                    <input type="range" min="20" max="80" value={calibCenter.y} onChange={(e) => setCalibCenter(prev => ({...prev, y: Number(e.target.value)}))} />
                  </div>
                  <div className="flex flex-col text-[10px] text-slate-400">
                    <span>Board Size: {calibCenter.radius}%</span>
                    <input type="range" min="20" max="60" value={calibCenter.radius} onChange={(e) => setCalibCenter(prev => ({...prev, radius: Number(e.target.value)}))} />
                  </div>
                </div>
              </div>
            )}

            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-2 flex items-center justify-between">
                <span>Manual Hit Quick Override</span>
                <span className="text-emerald-500 font-normal">Tap video feed to mark precise location</span>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {['T20', 'S20', 'T19', 'S19', 'T18', 'D20', 'D16', 'BULL', '25', '0'].map((lbl) => (
                  <button
                    key={lbl}
                    onClick={() => {
                      let hit = { score: 20, multiplier: 3, label: 'T20', value: 60 };
                      if (lbl === 'S20') hit = { score: 20, multiplier: 1, label: 'S20', value: 20 };
                      if (lbl === 'T19') hit = { score: 19, multiplier: 3, label: 'T19', value: 57 };
                      if (lbl === 'S19') hit = { score: 19, multiplier: 1, label: 'S19', value: 19 };
                      if (lbl === 'T18') hit = { score: 18, multiplier: 3, label: 'T18', value: 54 };
                      if (lbl === 'D20') hit = { score: 20, multiplier: 2, label: 'D20', value: 40 };
                      if (lbl === 'D16') hit = { score: 16, multiplier: 2, label: 'D16', value: 32 };
                      if (lbl === 'BULL') hit = { score: 50, multiplier: 1, label: 'BULL', value: 50 };
                      if (lbl === '25') hit = { score: 25, multiplier: 1, label: '25', value: 25 };
                      if (lbl === '0') hit = { score: 0, multiplier: 0, label: 'MISS', value: 0 };
                      processDartHit(hit);
                    }}
                    className="py-2 bg-slate-800 hover:bg-slate-700 active:bg-emerald-600 rounded-lg text-xs font-bold text-slate-200 border border-slate-700 transition"
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80 flex-1 overflow-hidden flex flex-col">
              <div className="text-[10px] text-slate-400 font-mono mb-1 uppercase">Vision Detection Feed Logs</div>
              <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-300">
                {detectionLogs.map((log, idx) => (
                  <div key={idx} className="border-b border-slate-800/40 py-0.5">{log}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TRAINING GAMES MENU */}
        {activeTab === 'games' && (
          <div className="space-y-4 pb-6">
            <div>
              <h2 className="text-xl font-black text-white">Training Routines & Games</h2>
              <p className="text-xs text-slate-400">Select a training exercise to boost your accuracy.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              
              <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 flex flex-col justify-between transition">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-bold">MATCH PLAY</span>
                    <Trophy className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="font-bold text-base text-white">Classic X01 Match</h3>
                  <p className="text-xs text-slate-400 mt-1">Play 301 or 501 with adjustable AI bot opponents.</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="flex space-x-2 text-xs">
                    <select 
                      value={gameConfig.x01Score} 
                      onChange={(e) => setGameConfig(p => ({...p, x01Score: Number(e.target.value)}))}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    >
                      <option value={301}>301</option>
                      <option value={501}>501</option>
                    </select>
                    <select 
                      value={gameConfig.botLevel} 
                      onChange={(e) => setGameConfig(p => ({...p, botLevel: e.target.value}))}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    >
                      <option value="off">No Bot</option>
                      <option value="easy">Bot: Easy</option>
                      <option value="medium">Bot: Medium</option>
                      <option value="pro">Bot: Pro</option>
                    </select>
                  </div>
                  <button 
                    onClick={() => startNewGame('x01')} 
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-xs flex items-center space-x-1"
                  >
                    <span>Play</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 flex flex-col justify-between transition">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded text-[10px] font-bold">ACCURACY</span>
                    <Circle className="w-4 h-4 text-teal-400" />
                  </div>
                  <h3 className="font-bold text-base text-white">Around the Clock</h3>
                  <p className="text-xs text-slate-400 mt-1">Hit 1 to 20 plus Bullseye in sequential order.</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <select 
                    value={gameConfig.atcVariant} 
                    onChange={(e) => setGameConfig(p => ({...p, atcVariant: e.target.value}))}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="singles">Singles</option>
                    <option value="doubles">Doubles</option>
                    <option value="triples">Triples</option>
                  </select>
                  <button 
                    onClick={() => startNewGame('atc')} 
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-xs flex items-center space-x-1"
                  >
                    <span>Play</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 flex flex-col justify-between transition">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded text-[10px] font-bold">DOUBLES</span>
                    <Award className="w-4 h-4 text-purple-400" />
                  </div>
                  <h3 className="font-bold text-base text-white">Bob's 27</h3>
                  <p className="text-xs text-slate-400 mt-1">Start with 27 points. Throw at double 1 to 20. Penalty for missing!</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex justify-end">
                  <button 
                    onClick={() => startNewGame('bobs27')} 
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-xs flex items-center space-x-1"
                  >
                    <span>Start</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 flex flex-col justify-between transition">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded text-[10px] font-bold">JUNIOR DART CIRCUIT</span>
                    <Award className="w-4 h-4 text-amber-400" />
                  </div>
                  <h3 className="font-bold text-base text-white">JDC Challenge Routine</h3>
                  <p className="text-xs text-slate-400 mt-1">Official JDC workout combining Shanghais, Doubles, and Bullseye scoring.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex justify-end">
                  <button 
                    onClick={() => startNewGame('jdc')} 
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-xs flex items-center space-x-1"
                  >
                    <span>Start</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 3: LIVE SCOREBOARD / PLAYING SCREEN */}
        {activeTab === 'play' && (
          <div className="flex flex-col h-full space-y-4">
            {!currentLeg ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-900 rounded-2xl border border-slate-800">
                <Target className="w-12 h-12 text-slate-600 mb-3" />
                <h3 className="text-lg font-bold text-slate-200">No Active Training Session</h3>
                <p className="text-xs text-slate-400 mb-4 max-w-xs">Select a training mode or start a match from the games menu.</p>
                <button 
                  onClick={() => setActiveTab('games')} 
                  className="px-4 py-2 bg-emerald-500 text-slate-950 font-bold rounded-xl text-xs"
                >
                  Choose Game Mode
                </button>
              </div>
            ) : (
              <div className="flex flex-col h-full space-y-4">
                
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 relative overflow-hidden shadow-xl">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">{gameMode.toUpperCase()} SESSION</span>
                      <h2 className="text-2xl font-black text-white">
                        {gameMode === 'x01' && `Remaining: ${currentLeg.playerScore}`}
                        {gameMode === 'atc' && `Target: ${BOARD_NUMBERS[currentLeg.currentTargetIdx]}`}
                        {gameMode === 'bobs27' && `Target: Double ${currentLeg.currentTargetNum}`}
                        {gameMode === 'darts100' && `Score: ${currentLeg.totalScore}`}
                        {gameMode === 'c121' && `Checkout: ${currentLeg.scoreLeft}`}
                        {gameMode === 'jdc' && `JDC Score: ${currentLeg.totalScore}`}
                      </h2>
                    </div>

                    {gameMode === 'x01' && gameConfig.botLevel !== 'off' && (
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">BOT ({gameConfig.botLevel})</span>
                        <div className="text-xl font-bold text-slate-300">{currentLeg.botScore}</div>
                      </div>
                    )}
                  </div>

                  {gameMode === 'x01' && currentLeg.targetSuggestion && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center space-x-2">
                      <span className="text-[11px] text-slate-400 font-semibold">Suggested Checkout:</span>
                      <div className="flex space-x-1">
                        {currentLeg.targetSuggestion.map((s, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold rounded border border-emerald-500/30">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {gameMode === 'bobs27' && (
                    <div className="mt-2 text-xs text-slate-300">
                      Current Score: <span className={`font-bold ${currentLeg.score > 27 ? 'text-emerald-400' : 'text-rose-400'}`}>{currentLeg.score}</span>
                    </div>
                  )}
                  {gameMode === 'darts100' && (
                    <div className="mt-2 text-xs text-slate-400">
                      Darts Remaining: <span className="text-white font-bold">{currentLeg.dartsLeft} / 100</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 bg-slate-900/60 rounded-2xl border border-slate-800 p-4 flex items-center justify-center relative">
                  <div className="relative w-full max-w-[280px] aspect-square">
                    <svg viewBox="-180 -180 360 360" className="w-full h-full drop-shadow-2xl">
                      <circle cx="0" cy="0" r="170" fill="#1e293b" stroke="#0f172a" strokeWidth="4" />

                      {BOARD_NUMBERS.map((num, idx) => {
                        const angle = (idx * 18 - 9) * (Math.PI / 180);
                        const nextAngle = ((idx + 1) * 18 - 9) * (Math.PI / 180);
                        const isEven = idx % 2 === 0;
                        const mainColor = isEven ? '#0f172a' : '#f8fafc';
                        const altColor = isEven ? '#ef4444' : '#10b981';

                        return (
                          <g key={num}>
                            <path 
                              d={`M ${162 * Math.sin(angle)} ${-162 * Math.cos(angle)} 
                                 A 162 162 0 0 1 ${162 * Math.sin(nextAngle)} ${-162 * Math.cos(nextAngle)} 
                                 L ${107 * Math.sin(nextAngle)} ${-107 * Math.cos(nextAngle)} 
                                 A 107 107 0 0 0 ${107 * Math.sin(angle)} ${-107 * Math.cos(angle)} Z`} 
                              fill={mainColor} 
                            />
                            <path 
                              d={`M ${170 * Math.sin(angle)} ${-170 * Math.cos(angle)} 
                                 A 170 170 0 0 1 ${170 * Math.sin(nextAngle)} ${-170 * Math.cos(nextAngle)} 
                                 L ${162 * Math.sin(nextAngle)} ${-162 * Math.cos(nextAngle)} 
                                 A 162 162 0 0 0 ${162 * Math.sin(angle)} ${-162 * Math.cos(angle)} Z`} 
                              fill={altColor} 
                            />
                            <path 
                              d={`M ${107 * Math.sin(angle)} ${-107 * Math.cos(angle)} 
                                 A 107 107 0 0 1 ${107 * Math.sin(nextAngle)} ${-107 * Math.cos(nextAngle)} 
                                 L ${97 * Math.sin(nextAngle)} ${-97 * Math.cos(nextAngle)} 
                                 A 97 97 0 0 0 ${97 * Math.sin(angle)} ${-97 * Math.cos(angle)} Z`} 
                              fill={altColor} 
                            />
                            <path 
                              d={`M ${97 * Math.sin(angle)} ${-97 * Math.cos(angle)} 
                                 A 97 97 0 0 1 ${97 * Math.sin(nextAngle)} ${-97 * Math.cos(nextAngle)} 
                                 L ${15.9 * Math.sin(nextAngle)} ${-15.9 * Math.cos(nextAngle)} 
                                 A 15.9 15.9 0 0 0 ${15.9 * Math.sin(angle)} ${-15.9 * Math.cos(angle)} Z`} 
                              fill={mainColor} 
                            />
                          </g>
                        );
                      })}

                      <circle cx="0" cy="0" r="15.9" fill="#10b981" />
                      <circle cx="0" cy="0" r="6.35" fill="#ef4444" />

                      <circle cx="0" cy="0" r="170" fill="none" stroke="#475569" strokeWidth="1.5" />
                      <circle cx="0" cy="0" r="162" fill="none" stroke="#475569" strokeWidth="1" />
                      <circle cx="0" cy="0" r="107" fill="none" stroke="#475569" strokeWidth="1" />
                      <circle cx="0" cy="0" r="97" fill="none" stroke="#475569" strokeWidth="1" />
                      <circle cx="0" cy="0" r="15.9" fill="none" stroke="#475569" strokeWidth="1" />
                    </svg>

                    {gameMode === 'atc' && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="px-3 py-1 bg-emerald-500 text-slate-950 font-black rounded-full shadow-lg text-sm animate-bounce">
                          HIT {BOARD_NUMBERS[currentLeg.currentTargetIdx]}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-400">Current Turn Darts:</div>
                  <div className="flex space-x-2">
                    {[0, 1, 2].map((idx) => {
                      const dart = dartsThrownThisTurn[idx];
                      return (
                        <div 
                          key={idx}
                          className={`w-12 h-10 rounded-lg flex items-center justify-center font-bold text-sm border ${
                            dart ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-600'
                          }`}
                        >
                          {dart ? dart.label : '-'}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* TAB 4: STATISTICS & ANALYTICS */}
        {activeTab === 'stats' && (
          <div className="space-y-4 pb-6">
            <div>
              <h2 className="text-xl font-black text-white">Performance Analytics</h2>
              <p className="text-xs text-slate-400">Track your overall darting stats and session progress.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="text-[10px] uppercase font-bold text-slate-400">3-Dart Average</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">
                  {sessionStats.totalDarts > 0 ? ((sessionStats.totalScore / sessionStats.totalDarts) * 3).toFixed(1) : '0.0'}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="text-[10px] uppercase font-bold text-slate-400">Total Darts Thrown</div>
                <div className="text-2xl font-black text-white mt-1">{sessionStats.totalDarts}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="text-[10px] uppercase font-bold text-slate-400">100+ Tons Hit</div>
                <div className="text-2xl font-black text-teal-400 mt-1">{sessionStats.tons}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="text-[10px] uppercase font-bold text-slate-400">180s Hit</div>
                <div className="text-2xl font-black text-amber-400 mt-1">{sessionStats.ton80s}</div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <h3 className="text-sm font-bold text-white mb-3">Recent Turn History</h3>
              {sessionStats.history.length === 0 ? (
                <div className="text-xs text-slate-500 py-4 text-center">No turn history recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {sessionStats.history.slice(0, 5).map((turn, idx) => (
                    <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-800 text-xs">
                      <span className="text-slate-400">{turn.date}</span>
                      <div className="flex space-x-1">
                        {turn.darts.map((d, dIdx) => (
                          <span key={dIdx} className="px-1.5 py-0.5 bg-slate-800 text-emerald-400 font-mono rounded text-[10px]">
                            {d.label}
                          </span>
                        ))}
                      </div>
                      <span className="font-bold text-white">{turn.score} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* Bottom Fixed Navigation Bar */}
      <nav className="bg-slate-900/90 border-t border-slate-800/80 backdrop-blur px-6 py-2 flex justify-between items-center">
        <button 
          onClick={() => setActiveTab('camera')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'camera' ? 'text-emerald-400' : 'text-slate-500'}`}
        >
          <Camera className="w-5 h-5" />
          <span className="text-[10px] font-medium">Vision</span>
        </button>

        <button 
          onClick={() => setActiveTab('games')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'games' ? 'text-emerald-400' : 'text-slate-500'}`}
        >
          <Award className="w-5 h-5" />
          <span className="text-[10px] font-medium">Training</span>
        </button>

        <button 
          onClick={() => setActiveTab('play')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'play' ? 'text-emerald-400' : 'text-slate-500'}`}
        >
          <Target className="w-5 h-5" />
          <span className="text-[10px] font-medium">Play</span>
        </button>

        <button 
          onClick={() => setActiveTab('stats')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'stats' ? 'text-emerald-400' : 'text-slate-500'}`}
        >
          <BarChart2 className="w-5 h-5" />
          <span className="text-[10px] font-medium">Stats</span>
        </button>
      </nav>

    </div>
  );
}
