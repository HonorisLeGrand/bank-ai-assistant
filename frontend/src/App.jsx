import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Bot, User, ShieldCheck, 
  BookOpen, Building2, ChevronRight, CheckCircle, 
  Database, Cpu, MessageSquare 
} from './Icons';

export default function App() {
  const [activeTab, setActiveTab] = useState('demo'); // 'presentation' or 'demo'
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Bonjour et bienvenue sur **BANCOBU AI**, votre conseiller bancaire intelligent de nouvelle génération. Comment puis-je vous éclairer aujourd'hui concernant les offres, comptes ou services de la BANCOBU ?",
      sources: []
    }
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const suggestedQuestions = [
    "Quelles sont les conditions d'ouverture d'un compte courant ?",
    "Comment fonctionne le service BANCOBU Diaspora ?",
    "Quels sont les avantages d'un compte épargne ?",
    "Quelles pièces justificatives fournir pour un prêt ?"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (questionText) => {
    const query = questionText || inputQuestion;
    if (!query.trim() || isLoading) return;

    const userMessage = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMessage]);
    setInputQuestion('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorDetail = data?.detail || `Erreur HTTP ${response.status}`;
        throw new Error(errorDetail);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          sources: data.sources || []
        }
      ]);
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header / Navigation */}
      <header className="glass" style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => setActiveTab('presentation')}>
            <div style={{ background: 'linear-gradient(135deg, #0284c7, #2563eb)', padding: '10px', borderRadius: '12px', display: 'flex' }}>
              <Building2 size={24} style={{ color: '#fff' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.5px' }}>BANCOBU</span>
                <span style={{ fontSize: '0.75rem', background: 'rgba(2,132,199,0.2)', color: '#38bdf8', padding: '2px 8px', borderRadius: '20px', border: '1px solid rgba(56,189,248,0.3)', fontWeight: 600 }}>AI RAG</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Banque Commerciale du Burundi — Assistant Intelligent</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '12px' }}>
            <button
              onClick={() => setActiveTab('presentation')}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                color: activeTab === 'presentation' ? '#fff' : '#94a3b8',
                background: activeTab === 'presentation' ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'transparent',
                transition: 'all 0.2s ease'
              }}
            >
              Présentation & Innovation
            </button>
            <button
              onClick={() => setActiveTab('demo')}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                color: activeTab === 'demo' ? '#fff' : '#94a3b8',
                background: activeTab === 'demo' ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <Sparkles size={16} /> Tester l'Assistant
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'presentation' ? (
          /* ================= PRESENTATION & INNOVATION SHOWCASE ================= */
          <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 24px', width: '100%' }}>
            {/* Hero Section */}
            <section style={{ textAlign: 'center', marginBottom: '64px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '999px', background: 'rgba(2, 132, 199, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', marginBottom: '24px' }}>
                <Sparkles size={16} style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: '0.85rem', color: '#bae6fd', fontWeight: 600 }}>L'Innovation Bancaire par IA Souveraine</span>
              </div>
              <h1 style={{ fontSize: '3rem', fontWeight: 800, lineHeight: 1.15, marginBottom: '20px', letterSpacing: '-1px' }}>
                L'Intelligence Artificielle au Service de la <br />
                <span style={{ background: 'linear-gradient(90deg, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  Relation Client BANCOBU
                </span>
              </h1>
              <p style={{ fontSize: '1.2rem', color: '#94a3b8', maxWidth: '750px', margin: '0 auto 36px', lineHeight: 1.6 }}>
                Fini les réponses vagues ou approximatives. Notre moteur combine la puissance d'embeddings locaux avec la finesse de <strong>Gemini</strong> pour offrir des réponses bancaires fiables, traçables et certifiées par les documents officiels.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
                <button
                  onClick={() => setActiveTab('demo')}
                  className="glow-btn"
                  style={{
                    padding: '14px 32px',
                    borderRadius: '12px',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <MessageSquare size={18} />
                  Démarrer une conversation
                </button>
              </div>
            </section>

            {/* Architecture RAG Highlighting */}
            <section style={{ marginBottom: '64px' }}>
              <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '8px' }}>Comment Fonctionne Notre Innovation RAG ?</h2>
                <p style={{ color: '#94a3b8' }}>Une chaîne technologique rigoureuse garantissant 0 hallucination</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
                <div className="glass" style={{ padding: '24px', borderRadius: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(2, 132, 199, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                    <BookOpen size={24} style={{ color: '#38bdf8' }} />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>1. Ingestion Certifiée</h3>
                  <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    Extraction et découpage intelligent de la documentation officielle BANCOBU en respectant la structure des offres.
                  </p>
                </div>

                <div className="glass" style={{ padding: '24px', borderRadius: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                    <Database size={24} style={{ color: '#34d399' }} />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>2. Recherche Sémantique Qdrant</h3>
                  <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    Vectorisation avec <em>embeddinggemma</em> et indexation vectorielle haute vitesse pour retrouver le bon paragraphe en millisecondes.
                  </p>
                </div>

                <div className="glass" style={{ padding: '24px', borderRadius: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                    <Cpu size={24} style={{ color: '#a78bfa' }} />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>3. Raisonnement Gemini</h3>
                  <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    Synthèse naturelle par le modèle de Google guidé par des consignes strictes de conformité bancaire et de neutralité.
                  </p>
                </div>

                <div className="glass" style={{ padding: '24px', borderRadius: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                    <ShieldCheck size={24} style={{ color: '#fbbf24' }} />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>4. Traçabilité Totale</h3>
                  <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    Chaque réponse indique explicitement les numéros de page originaux consultés pour une conformité et vérification immédiate.
                  </p>
                </div>
              </div>
            </section>

            {/* Key Benefits */}
            <section className="glass" style={{ padding: '40px', borderRadius: '24px', border: '1px solid rgba(2, 132, 199, 0.3)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '16px' }}>Une Expérience Client Révolutionnée</h2>
                  <p style={{ color: '#94a3b8', lineHeight: 1.6, marginBottom: '24px' }}>
                    Offrez à vos clients et collaborateurs une assistance 24/7 capable de répondre instantanément aux demandes les plus pointues : comptes devises, crédits, diaspora et formalités administratives.
                  </p>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {[
                      "Réduction drastique des temps d'attente en agence et au centre d'appel",
                      "Élimination des erreurs d'information sur les frais et conditions",
                      "Support bilingue et omnicanal adaptable au web, mobile et WhatsApp",
                      "Sécurité et confidentialité des données bancaires garanties"
                    ].map((benefit, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.95rem' }}>
                        <CheckCircle size={18} style={{ color: '#34d399', flexShrink: 0 }} />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ background: 'rgba(2, 132, 199, 0.08)', padding: '32px', borderRadius: '20px', border: '1px dashed rgba(56, 189, 248, 0.4)' }}>
                    <span style={{ fontSize: '3rem', fontWeight: 800, color: '#38bdf8' }}>100%</span>
                    <p style={{ fontWeight: 600, fontSize: '1.1rem', margin: '8px 0 4px' }}>Ancré dans vos sources</p>
                    <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Les réponses sont strictement extraites de bancobu_donnees.pdf</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* ================= INTERACTIVE CHAT UI ================= */
          <div style={{ flex: 1, maxWidth: '1000px', margin: '0 auto', width: '100%', padding: '24px 20px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 85px)' }}>
            
            {/* Messages Area */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', paddingRight: '8px' }}>
              {messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                return (
                  <div 
                    key={index} 
                    style={{ 
                      display: 'flex', 
                      gap: '14px', 
                      alignItems: 'flex-start',
                      alignSelf: isAssistant ? 'flex-start' : 'flex-end',
                      maxWidth: isAssistant ? '85%' : '75%'
                    }}
                  >
                    {isAssistant && (
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #0284c7, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)' }}>
                        <Bot size={20} style={{ color: '#fff' }} />
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: isAssistant ? 'flex-start' : 'flex-end' }}>
                      <div 
                        className={isAssistant ? "glass" : ""}
                        style={{
                          padding: '16px 20px',
                          borderRadius: isAssistant ? '4px 18px 18px 18px' : '18px 4px 18px 18px',
                          background: isAssistant ? (msg.error ? 'rgba(153, 27, 27, 0.35)' : 'rgba(15, 23, 42, 0.85)') : 'linear-gradient(135deg, #0284c7, #2563eb)',
                          color: '#fff',
                          border: isAssistant ? (msg.error ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)') : 'none',
                          fontSize: '0.95rem',
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                        }}
                      >
                        {msg.content}
                      </div>

                      {/* Display Sources for Assistant Responses */}
                      {isAssistant && msg.sources && msg.sources.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                          <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <BookOpen size={12} /> Sources consultées :
                          </span>
                          {msg.sources.map((src, sIdx) => (
                            <span 
                              key={sIdx}
                              style={{
                                fontSize: '0.75rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                color: '#94a3b8'
                              }}
                            >
                              Page {src.page} ({src.source})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isAssistant && (
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <User size={20} style={{ color: '#e2e8f0' }} />
                      </div>
                    )}
                  </div>
                );
              })}

              {isLoading && (
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', alignSelf: 'flex-start' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #0284c7, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bot size={20} style={{ color: '#fff' }} />
                  </div>
                  <div className="glass" style={{ padding: '12px 18px', borderRadius: '4px 18px 18px 18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Recherche dans les documents BANCOBU & analyse Gemini...</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.4s infinite ease-in-out' }}></span>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.4s infinite ease-in-out 0.2s' }}></span>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.4s infinite ease-in-out 0.4s' }}></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Prompts pills */}
            {messages.length <= 2 && (
              <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '8px', fontWeight: 600 }}>Suggestions fréquentes :</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {suggestedQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(q)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        color: '#94a3b8',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                        e.currentTarget.style.color = '#38bdf8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                        e.currentTarget.style.color = '#94a3b8';
                      }}
                    >
                      <ChevronRight size={12} />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input Box */}
            <div style={{ marginTop: '16px' }}>
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                className="glass"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                }}
              >
                <input
                  type="text"
                  placeholder="Posez votre question sur les produits ou services BANCOBU..."
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#fff',
                    padding: '10px 14px',
                    fontSize: '0.95rem'
                  }}
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={!inputQuestion.trim() || isLoading}
                  className="glow-btn"
                  style={{
                    padding: '10px 18px',
                    borderRadius: '10px',
                    border: 'none',
                    color: '#fff',
                    cursor: !inputQuestion.trim() || isLoading ? 'not-allowed' : 'pointer',
                    opacity: !inputQuestion.trim() || isLoading ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 600
                  }}
                >
                  <span>Envoyer</span>
                  <Send size={16} />
                </button>
              </form>
              <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#64748b', marginTop: '8px' }}>
                BANCOBU AI est connecté en temps réel aux données documentaires de la banque.
              </p>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
