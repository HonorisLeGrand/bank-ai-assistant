import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Bot, User, ShieldCheck, 
  BookOpen, ChevronRight, CheckCircle, 
  Database, Cpu, MessageSquare, Phone, MapPin,
  Mic, MicOff, Volume2, Square
} from './Icons';

export default function App() {
  const [activeTab, setActiveTab] = useState('demo'); // 'presentation' or 'demo'
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Bonjour et bienvenue sur **BANCOBU AI**, votre conseiller bancaire intelligent officiel.\n\nJe suis à votre disposition pour vous renseigner avec précision sur nos comptes, nos cartes bancaires, nos offres d'épargne ou encore nos crédits, certifiés conformes par la documentation officielle de la BANCOBU.\n\nVous pouvez me poser votre question par écrit ou **directement à la voix en cliquant sur le micro** !",
      sources: []
    }
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [playingIndex, setPlayingIndex] = useState(null);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioPlayerRef = useRef(null);

  const suggestedQuestions = [
    "Conditions compte courant ?",
    "Service BANCOBU Diaspora ?",
    "Avantages compte KIRA MAMA ?",
    "Carte Visa prépayée ?"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, isTranscribing]);

  // Initialisation du module Speech-To-Text Web Speech API (fallback navigateur)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'fr-FR';

        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setInputQuestion(transcript);
            handleSend(transcript);
          }
        };

        recognition.onerror = (event) => {
          console.warn("SpeechRecognition avertissement:", event.error);
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = recognition;
      } catch (e) {
        console.warn("SpeechRecognition init error:", e);
      }
    }
  }, []);

  // Déclencher ou arrêter l'enregistrement audio
  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    // 1. Priorité à la reconnaissance native ultra-rapide (détection automatique de fin de parole)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        return;
      } catch (e) {
        console.warn("SpeechRecognition start échec, bascule MediaRecorder:", e);
      }
    }

    // 2. Alternative MediaRecorder (capture et transcription serveur)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      await startMediaRecording();
      return;
    }

    alert("Veuillez autoriser l'accès au microphone dans votre navigateur.");
  };

  const startMediaRecording = async () => {
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        if (audioChunksRef.current.length > 0) {
          const actualMime = recorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
          await sendAudioForTranscription(audioBlob);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      return;
    } catch (err) {
      console.warn("Échec getUserMedia :", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Vous avez refusé l'accès au microphone. Cliquez sur l'icône de cadenas/paramètres dans la barre d'adresse pour autoriser le micro.");
      } else {
        alert("Impossible de démarrer l'enregistrement : " + (err.message || "Erreur microphone"));
      }
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn(e);
      }
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn(e);
      }
    }
    setIsRecording(false);
  };

  // Envoi du blob audio au serveur FastAPI pour transcription Gemini
  const sendAudioForTranscription = async (blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, 'audio_prompt.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Erreur serveur lors de la transcription");
      }

      const data = await response.json();
      const transcribedText = data.transcript?.trim();

      if (transcribedText) {
        setInputQuestion(transcribedText);
        handleSend(transcribedText);
      } else {
        alert("Aucune parole audible détectée. Veuillez parler plus près du micro.");
      }
    } catch (err) {
      console.error("Erreur transcription vocale:", err);
      alert("Erreur lors de la transcription vocale. Vous pouvez également poser votre question par écrit.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // Jouer la synthèse vocale d'un message
  const playTTS = async (text, msgIndex) => {
    try {
      if (playingIndex === msgIndex) {
        audioPlayerRef.current?.pause();
        setPlayingIndex(null);
        return;
      }

      setPlayingIndex(msgIndex);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) throw new Error("Erreur génération audio");

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = audioUrl;
        audioPlayerRef.current.play();
        audioPlayerRef.current.onended = () => {
          setPlayingIndex(null);
        };
      }
    } catch (err) {
      console.error("Erreur lecture audio :", err);
      setPlayingIndex(null);
    }
  };

  const handleSend = async (questionText) => {
    const query = questionText || inputQuestion;
    if (!query.trim() || isLoading) return;

    if (isRecording) {
      stopRecording();
    }

    const userMessage = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMessage]);
    setInputQuestion('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorDetail = data?.detail || `Erreur HTTP ${response.status}`;
        throw new Error(errorDetail);
      }

      const newMsg = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources || []
      };

      setMessages((prev) => {
        const updated = [...prev, newMsg];
        if (autoPlayAudio) {
          playTTS(data.answer, updated.length - 1);
        }
        return updated;
      });

    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Information : ${err.message || "Impossible de joindre le serveur bancaire."}`,
          sources: [],
          error: true
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      
      {/* Audio player invisible */}
      <audio ref={audioPlayerRef} style={{ display: 'none' }} />

      {/* 1. TOP BAR BANCOBU VERTE (#4ba452) */}
      <div style={{ backgroundColor: '#4ba452', color: '#ffffff', fontSize: '0.8rem', padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
        <div className="top-bar-inner">
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
              <Phone size={13} /> +257 22 26 52 00
            </span>
            <span className="top-bar-location" style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.9 }}>
              <MapPin size={13} /> Bujumbura, Burundi
            </span>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontWeight: 600 }}>
            {/* Toggle Voix automatique */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', background: 'rgba(0,0,0,0.18)', padding: '2px 8px', borderRadius: '12px' }}>
              <input 
                type="checkbox" 
                checked={autoPlayAudio} 
                onChange={(e) => setAutoPlayAudio(e.target.checked)} 
                style={{ cursor: 'pointer' }}
              />
              <Volume2 size={12} />
              <span style={{ fontSize: '0.72rem' }}>Voix auto</span>
            </label>
            <span className="top-bar-hub" style={{ opacity: 0.9 }}>Digital Hub</span>
          </div>
        </div>
      </div>

      {/* 2. HEADER PRINCIPAL BLANC AVEC LOGO OFFICIEL */}
      <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="header-inner">
          
          {/* Logo & Titre */}
          <div className="header-brand-wrap" onClick={() => setActiveTab('demo')} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img 
                src="/Bancobu_Logo.png" 
                alt="Logo BANCOBU" 
                className="header-logo-img"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 800, fontSize: '1.15rem', color: '#2d3748', letterSpacing: '-0.5px' }}>BANCOBU</span>
                  <span style={{ fontSize: '0.68rem', backgroundColor: '#eef7ee', color: '#4ba452', padding: '1px 6px', borderRadius: '10px', border: '1px solid #c2e2c4', fontWeight: 700 }}>
                    IA & VOIX
                  </span>
                </div>
                <p className="header-title-sub">Banque Commerciale du Burundi</p>
              </div>
            </div>
          </div>

          {/* Onglets de navigation */}
          <nav className="header-nav">
            <button
              onClick={() => setActiveTab('demo')}
              className="nav-btn"
              style={{
                border: activeTab === 'demo' ? '2px solid #0080fe' : '1px solid #e2e8f0',
                color: activeTab === 'demo' ? '#ffffff' : '#4a5568',
                backgroundColor: activeTab === 'demo' ? '#0080fe' : '#ffffff',
                boxShadow: activeTab === 'demo' ? '0 4px 12px rgba(0, 128, 254, 0.25)' : 'none',
              }}
            >
              <Sparkles size={14} /> Conseiller Vocal
            </button>
            <button
              onClick={() => setActiveTab('presentation')}
              className="nav-btn"
              style={{
                border: activeTab === 'presentation' ? '2px solid #4ba452' : '1px solid #e2e8f0',
                color: activeTab === 'presentation' ? '#ffffff' : '#4a5568',
                backgroundColor: activeTab === 'presentation' ? '#4ba452' : '#ffffff',
                boxShadow: activeTab === 'presentation' ? '0 4px 12px rgba(75, 164, 82, 0.25)' : 'none',
              }}
            >
              Présentation
            </button>
          </nav>
        </div>
      </header>

      {/* 3. CORPS DE PAGE */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {activeTab === 'presentation' ? (
          /* ================= PRESENTATION & INNOVATION ================= */
          <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '30px 16px', width: '100%' }}>
            
            {/* Bannière Hero Style BANCOBU */}
            <div className="presentation-hero" style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '40px 30px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', marginBottom: '30px', textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '20px', backgroundColor: '#eef7ee', color: '#4ba452', border: '1px solid #c2e2c4', fontWeight: 700, fontSize: '0.82rem', marginBottom: '16px' }}>
                <Sparkles size={14} /> Innovation Bancaire : Voix & IA RAG
              </div>
              <h1 className="presentation-title" style={{ fontSize: '2.2rem', fontWeight: 800, color: '#1a202c', marginBottom: '14px', lineHeight: 1.25 }}>
                L'Intelligence Artificielle & la Voix au Cœur de la <br />
                <span style={{ color: '#4ba452' }}>Relation Client BANCOBU</span>
              </h1>
              <p className="presentation-desc" style={{ fontSize: '1.05rem', color: '#4a5568', maxWidth: '750px', margin: '0 auto 24px', lineHeight: 1.6 }}>
                Posez vos questions à la voix ou par écrit, et écoutez les réponses naturelles d'un conseiller virtuel, certifiées et sourcées à partir de la documentation officielle de la BANCOBU.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={() => setActiveTab('demo')}
                  style={{
                    backgroundColor: '#4ba452',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    boxShadow: '0 6px 18px rgba(75, 164, 82, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Mic size={17} />
                  Parler avec le conseiller
                </button>
              </div>
            </div>

            {/* Grille Piliers Technologiques */}
            <div style={{ marginBottom: '30px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#2d3748' }}>Une Chaîne Technologique Complète</h2>
                <p style={{ color: '#718096', fontSize: '0.9rem' }}>De la reconnaissance vocale à la synthèse audio haute fidélité</p>
              </div>

              <div className="tech-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#eef7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Mic size={20} style={{ color: '#4ba452' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>1. Entrée Vocale Omnicanale</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Transcrit la parole instantanément depuis PC, tablette ou smartphone.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#ebf8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Database size={20} style={{ color: '#0080fe' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>2. Recherche Sémantique Qdrant</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Localise les articles exacts dans <code>bancobu_donnees.pdf</code> en quelques millisecondes.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#fffaf0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Cpu size={20} style={{ color: '#de6906' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>3. Raisonnement Gemini</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Rédige une réponse claire, polie et certifiée respectant les directives bancaires.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#eef7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Volume2 size={20} style={{ color: '#4ba452' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>4. Voix Neuronale Naturelle</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Génération audio MP3 fluide avec voix de conseiller francophone naturelle (Edge-TTS).
                  </p>
                </div>
              </div>
            </div>

          </div>
        ) : (
          /* ================= CHATBOT BANCOBU AVEC AUDIO & MICRO ================= */
          <div className="chat-container">
            
            {/* Zone de discussion */}
            <div className="chat-messages">
              {messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                const isPlaying = playingIndex === index;

                return (
                  <div 
                    key={index} 
                    className="msg-row"
                    style={{ 
                      justifyContent: isAssistant ? 'flex-start' : 'flex-end',
                    }}
                  >
                    {isAssistant && (
                      <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#4ba452', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 6px rgba(75, 164, 82, 0.3)' }}>
                        <Bot size={18} style={{ color: '#ffffff' }} />
                      </div>
                    )}

                    <div 
                      className={isAssistant ? "msg-content-assistant" : "msg-content-user"}
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '5px', 
                        alignItems: isAssistant ? 'flex-start' : 'flex-end',
                        maxWidth: isAssistant ? '88%' : '78%'
                      }}
                    >
                      <div 
                        className="msg-bubble"
                        style={{
                          borderRadius: isAssistant ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                          backgroundColor: isAssistant ? (msg.error ? '#fff5f5' : '#ffffff') : '#4ba452',
                          color: isAssistant ? (msg.error ? '#c53030' : '#2d3748') : '#ffffff',
                          border: isAssistant ? (msg.error ? '1px solid #feb2b2' : '1px solid #e2e8f0') : 'none',
                        }}
                      >
                        {msg.content}

                        {/* Bouton pour écouter la réponse */}
                        {isAssistant && !msg.error && (
                          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => playTTS(msg.content, index)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '4px 10px',
                                borderRadius: '14px',
                                border: '1px solid #c2e2c4',
                                backgroundColor: isPlaying ? '#4ba452' : '#eef7ee',
                                color: isPlaying ? '#ffffff' : '#3d8a43',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              {isPlaying ? (
                                <>
                                  <Square size={11} /> Arrêter
                                </>
                              ) : (
                                <>
                                  <Volume2 size={12} /> Écouter la voix
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Sources consultées */}
                      {isAssistant && msg.sources && msg.sources.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                          <span style={{ fontSize: '0.72rem', color: '#718096', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <BookOpen size={11} style={{ color: '#4ba452' }} /> Pages vérifiées :
                          </span>
                          {msg.sources.map((src, sIdx) => (
                            <span 
                              key={sIdx}
                              style={{
                                fontSize: '0.7rem',
                                backgroundColor: '#eef7ee',
                                border: '1px solid #c2e2c4',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                color: '#3d8a43',
                                fontWeight: 600
                              }}
                            >
                              p.{src.page}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isAssistant && (
                      <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <User size={18} style={{ color: '#4a5568' }} />
                      </div>
                    )}
                  </div>
                );
              })}

              {isTranscribing && (
                <div className="msg-row" style={{ alignItems: 'center' }}>
                  <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#0080fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mic size={18} style={{ color: '#ffffff' }} />
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '4px 16px 16px 16px', backgroundColor: '#ffffff', border: '1px solid #cbd5e0', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                    <span style={{ fontSize: '0.82rem', color: '#2d3748', fontWeight: 600 }}>Transcription vocale en cours...</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#0080fe', animation: 'pulse 1s infinite' }}></span>
                    </div>
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="msg-row" style={{ alignItems: 'center' }}>
                  <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#4ba452', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bot size={18} style={{ color: '#ffffff' }} />
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '4px 16px 16px 16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                    <span style={{ fontSize: '0.82rem', color: '#718096' }}>Recherche BANCOBU & synthèse vocale...</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#4ba452' }}></span>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#0080fe' }}></span>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#de6906' }}></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Questions fréquentes suggérées */}
            {messages.length <= 2 && (
              <div>
                <p style={{ fontSize: '0.72rem', color: '#718096', marginTop: '6px', marginBottom: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Suggestions rapides :
                </p>
                <div className="suggested-chips-container">
                  {suggestedQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(q)}
                      className="suggested-chip"
                    >
                      <ChevronRight size={12} style={{ color: '#4ba452' }} />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Barre de saisie avec bouton Micro Vocal */}
            <div style={{ marginTop: '8px' }}>
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                className="input-form"
                style={{
                  border: isRecording ? '2px solid #ef4444' : '2px solid #cbd5e0',
                  boxShadow: isRecording ? '0 0 14px rgba(239, 68, 68, 0.3)' : '0 3px 10px rgba(0, 0, 0, 0.05)',
                }}
              >
                {/* Bouton Micro */}
                <button
                  type="button"
                  onClick={toggleRecording}
                  className="mic-button"
                  title={isRecording ? "Arrêter l'enregistrement (cliquez pour terminer)" : "Parler au micro"}
                  style={{
                    backgroundColor: isRecording ? '#ef4444' : '#eef7ee',
                    color: isRecording ? '#ffffff' : '#4ba452',
                    border: 'none',
                    borderRadius: '50%',
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    marginRight: '8px',
                    flexShrink: 0,
                    animation: isRecording ? 'pulse 1.5s infinite' : 'none'
                  }}
                >
                  {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                <input
                  type="text"
                  placeholder={
                    isRecording 
                      ? "🔴 Enregistrement en cours... Cliquez à nouveau pour envoyer" 
                      : (isTranscribing ? "Transcription vocale..." : "Écrivez ou touchez le micro pour parler...")
                  }
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  className="input-text-field"
                  disabled={isLoading || isTranscribing}
                />

                <button
                  type="submit"
                  disabled={!inputQuestion.trim() || isLoading || isTranscribing}
                  className="send-button"
                  style={{
                    cursor: !inputQuestion.trim() || isLoading || isTranscribing ? 'not-allowed' : 'pointer',
                    opacity: !inputQuestion.trim() || isLoading || isTranscribing ? 0.6 : 1,
                  }}
                >
                  <span className="send-button-text">Envoyer</span>
                  <Send size={14} />
                </button>
              </form>

              <div className="chat-disclaimer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.72rem', color: '#a0aec0' }}>
                <span>BANCOBU AI • Support vocal & écrit</span>
                <span>© BANCOBU — Banque Commerciale du Burundi</span>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* 4. FOOTER OFFICIEL BANCOBU (#2b2f3b) */}
      <footer className={`footer-section ${activeTab === 'demo' ? 'footer-in-chat' : ''}`}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <span style={{ fontWeight: 700, color: '#ffffff' }}>BANCOBU S.A.</span> — Siège Social : Boulevard de la Liberté, Bujumbura
          </div>
          <div>
            <span>Tél: +257 22 26 52 00 | info@bancobu.com</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
