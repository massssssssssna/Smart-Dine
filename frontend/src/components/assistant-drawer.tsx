'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Sparkles, X, Send, RotateCcw, ShieldCheck, History, Copy, Check, 
  ChevronRight, ArrowRight, TrendingUp, AlertTriangle, MessageSquare, 
  LineChart, Receipt, ExternalLink, RefreshCw, AlertCircle, Info, Database
} from 'lucide-react';
import { 
  api, ApiError,
  AssistantEvidence, AssistantQuestionRequest, AssistantQuestionResponse, 
  AssistantChatMessage, AssistantRunRecord, Page
} from '@/lib/api';

type DatePreset = '6m' | 'today' | '7d' | 'month' | '30d' | 'custom';

interface AssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const STARTER_PROMPTS = [
  {
    title: 'Highest Profit Margin Dishes',
    prompt: 'Which menu items have the highest profit margin and contribute most to net income?',
    tag: 'Menu Profitability'
  },
  {
    title: 'Low Stock Ingredients Alert',
    prompt: 'Show ingredients below reorder threshold that need urgent restocking.',
    tag: 'Inventory Warning'
  },
  {
    title: 'Net Profit Comparison',
    prompt: 'Compare this week’s net profit and operating expenses with last week. Did margins expand or fall?',
    tag: 'Financial P&L'
  },
  {
    title: 'Customer Complaints & Sentiment',
    prompt: 'What are customers complaining about most in recent reviews?',
    tag: 'Guest Feedback'
  },
];

function evidenceLabel(value:string){return value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());}
function EvidenceValue({value}:{value:unknown}):React.ReactNode{
  if(value===null||value===undefined||value==='')return <span>Not recorded</span>;
  if(Array.isArray(value))return value.length?<ul>{value.map((item,index)=><li key={index}><EvidenceValue value={item}/></li>)}</ul>:<span>None</span>;
  if(typeof value==='object')return <dl className="evidence-readable">{Object.entries(value as Record<string,unknown>).map(([key,item])=><div key={key}><dt>{evidenceLabel(key)}</dt><dd><EvidenceValue value={item}/></dd></div>)}</dl>;
  if(typeof value==='boolean')return <span>{value?'Yes':'No'}</span>;
  return <span>{String(value)}</span>;
}

export function AssistantDrawer({ isOpen, onClose }: AssistantDrawerProps) {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStep, setThinkingStep] = useState<string>('');
  
  // Date Context State
  const [datePreset, setDatePreset] = useState<DatePreset>('6m');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateLabel, setDateLabel] = useState('Preparing reporting range…');

  // Selected Evidence Inspector Modal
  const [inspectingEvidence, setInspectingEvidence] = useState<AssistantEvidence | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  // History Tab State
  const [showHistory, setShowHistory] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<AssistantRunRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [serviceNotice, setServiceNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Use the current local calendar date; the server interprets the range in Asia/Karachi.
  const computeDateRange = useCallback((preset: DatePreset) => {
    const karachiToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const [year, month, day] = karachiToday.split('-').map(Number);
    const today = new Date(Date.UTC(year, month - 1, day, 12));
    let start = new Date(today);
    let end = new Date(today);

    if (preset === '6m') {
      start.setUTCMonth(today.getUTCMonth() - 6);
    } else if (preset === 'today') {
      start = new Date(today);
    } else if (preset === '7d') {
      start.setUTCDate(today.getUTCDate() - 6);
    } else if (preset === 'month') {
      start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
    } else if (preset === '30d') {
      start.setUTCDate(today.getUTCDate() - 29);
    }

    const sStr = start.toISOString().slice(0, 10);
    const eStr = end.toISOString().slice(0, 10);
    return { sStr, eStr };
  }, []);

  useEffect(() => {
    if (datePreset !== 'custom') {
      const { sStr, eStr } = computeDateRange(datePreset);
      setStartDate(sStr);
      setEndDate(eStr);
      setDateLabel(`Analyzing: ${sStr} to ${eStr} (Asia/Karachi)`);
    }
  }, [datePreset, computeDateRange]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inspectingEvidence) {
          setInspectingEvidence(null);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, inspectingEvidence]);

  // Load Assistant Runs History
  const loadRuns = async () => {
    setLoadingHistory(true);
    try {
      const res = await api<Page<AssistantRunRecord>>('assistant/runs?limit=25&offset=0');
      setHistoryRuns(res.items || []);
    } catch {
      // Ignored if runs table is empty or permission denied
    } finally {
      setLoadingHistory(false);
    }
  };

  // Submit Query to Assistant
  const handleSend = async (queryText?: string) => {
    const text = (queryText || inputQuery).trim();
    if (!text || isThinking) return;

    const userMsgId = 'user-' + Date.now();
    const assistantMsgId = 'asst-' + Date.now();

    const userMessage: AssistantChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      period: { start_date: startDate, end_date: endDate }
    };

    setMessages(prev => [...prev, userMessage]);
    setInputQuery('');
    setIsThinking(true);
    setThinkingStep('Connecting to audited database...');

    const timer1 = setTimeout(() => setThinkingStep('Executing server read tools (sales_and_margins, inventory)...'), 700);
    const timer2 = setTimeout(() => setThinkingStep('Validating citations & synthesizing executive answer...'), 1600);

    try {
      setServiceNotice(null);
      const reqBody: AssistantQuestionRequest = {
        question: text,
        start_date: startDate,
        end_date: endDate
      };
      const result = await api<AssistantQuestionResponse>('assistant/questions', 'POST', reqBody);

      const assistantMessage: AssistantChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: result.answer,
        timestamp: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
        period: result.period,
        evidence: result.evidence,
        evidence_ids: result.evidence_ids,
        verified_metrics: result.verified_metrics,
        notice: result.notice,
        status: 'completed'
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: unknown) {
      const err = error as Error;
      if (error instanceof ApiError && error.status === 503) {
        setServiceNotice('The manager assistant is temporarily unavailable. Ask the administrator to configure the assistant service.');
      }
      const errorMessage: AssistantChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: `Could not process this question through the assistant API: ${err.message || 'Server error'}. No substitute or sample answer was generated.`,
        timestamp: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
        status: 'error',
        errorMessage: err.message
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      setIsThinking(false);
      setThinkingStep('');
    }
  };

  // Helper to parse citations and make [E1: ...] chips clickable
  const renderMessageContent = (content: string, evidenceList?: AssistantEvidence[]) => {
    // Regex matches [E1], [E2], [E1: Sales & Margins], [E2: Inventory Levels], etc.
    const citationRegex = /\[(E\d+)(?::\s*([^\]]+))?\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      const fullMatch = match[0];
      const evId = match[1];
      const evLabel = match[2] || (evId === 'E1' ? 'Sales & Margins' : evId === 'E2' ? 'Inventory Levels' : evId === 'E3' ? 'Customer Reviews' : 'Verified Data');
      const matchIndex = match.index;

      // Text before citation
      if (matchIndex > lastIndex) {
        parts.push(renderFormattedText(content.substring(lastIndex, matchIndex), `text-${lastIndex}`));
      }

      // Find matching evidence item
      const matchingEvidence = evidenceList?.find(e => e.id === evId) || {
        id: evId,
        tool: evLabel.toLowerCase().replace(/ /g, '_'),
        period: { start_date: startDate, end_date: endDate },
        data: {},
        temporal_scope: 'Audited database snapshot'
      };

      // Determine color theme for tool
      const tool = matchingEvidence.tool?.toLowerCase() || '';
      let badgeClass = 'evidence-chip-emerald';
      let ToolIcon = TrendingUp;

      if (tool.includes('inventory') || tool.includes('stock')) {
        badgeClass = 'evidence-chip-amber';
        ToolIcon = AlertTriangle;
      } else if (tool.includes('review')) {
        badgeClass = 'evidence-chip-purple';
        ToolIcon = MessageSquare;
      } else if (tool.includes('forecast')) {
        badgeClass = 'evidence-chip-blue';
        ToolIcon = LineChart;
      } else if (tool.includes('expense')) {
        badgeClass = 'evidence-chip-rose';
        ToolIcon = Receipt;
      }

      parts.push(
        <button
          key={`ev-${matchIndex}`}
          type="button"
          onClick={() => setInspectingEvidence(matchingEvidence)}
          className={`evidence-chip ${badgeClass}`}
          title={`Click to inspect verified calculation from ${matchingEvidence.tool}`}
        >
          <ToolIcon size={12} />
          <span>{evId}: {evLabel}</span>
          <ExternalLink size={10} className="chip-arrow" />
        </button>
      );

      lastIndex = matchIndex + fullMatch.length;
    }

    if (lastIndex < content.length) {
      parts.push(renderFormattedText(content.substring(lastIndex), `text-${lastIndex}`));
    }

    return parts.length > 0 ? parts : renderFormattedText(content, 'root');
  };

  // Basic Markdown Formatter (bold, bullet points, headers)
  const renderFormattedText = (text: string, keyPrefix: string) => {
    const lines = text.split('\n');
    return (
      <span key={keyPrefix}>
        {lines.map((line, idx) => {
          if (line.startsWith('### ')) {
            return <strong key={idx} className="block mt-2 mb-1 text-sm text-forest font-semibold">{line.slice(4)}</strong>;
          }
          if (line.startsWith('• ') || line.startsWith('- ')) {
            return (
              <span key={idx} className="block pl-3 text-xs leading-relaxed my-0.5">
                <span className="text-forest mr-1.5">•</span>
                {parseInlineBold(line.slice(2))}
              </span>
            );
          }
          if (/^\d+\.\s/.test(line)) {
            return (
              <span key={idx} className="block pl-3 text-xs leading-relaxed my-0.5">
                {parseInlineBold(line)}
              </span>
            );
          }
          return (
            <span key={idx} className="block text-xs leading-relaxed">
              {parseInlineBold(line)}
            </span>
          );
        })}
      </span>
    );
  };

  const parseInlineBold = (str: string) => {
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-forest">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const copyEvidenceJson = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const clearChat = () => {
    if (confirm('Clear assistant conversation history?')) {
      setMessages([]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="assistant-drawer-overlay" onClick={onClose}>
      <aside 
        className="assistant-drawer-panel" 
        onClick={e => e.stopPropagation()}
        aria-label="Smart Dine Manager Assistant"
      >
        {/* Drawer Header */}
        <header className="assistant-header">
          <div className="header-left">
            <div className="ai-badge-wrap">
              <Sparkles size={18} className="ai-icon" />
              <div className="pulse-indicator" />
            </div>
            <div>
              <div className="title-row">
                <h2>Smart Dine Assistant</h2>
              </div>
              <p className="subtitle">Answers based on recorded restaurant data</p>
            </div>
          </div>

          <div className="header-actions">
            <button 
              type="button" 
              className={`icon-action-btn ${showHistory ? 'active' : ''}`}
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) loadRuns();
              }}
              title="Previous questions"
            >
              <History size={16} />
            </button>
            <button 
              type="button" 
              className="icon-action-btn"
              onClick={clearChat}
              title="Clear Conversation"
              disabled={messages.length === 0}
            >
              <RotateCcw size={16} />
            </button>
            <button 
              type="button" 
              className="icon-action-btn close-btn"
              onClick={onClose}
              title="Close Drawer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {serviceNotice && (
          <div className="groq-notice-banner">
            <Info size={14} className="notice-icon" />
            <span>{serviceNotice}</span>
          </div>
        )}

        {/* Step 5.2 — Context & Date Range Bar */}
        <div className="assistant-context-bar">
          <div className="context-header">
            <span className="context-label">
              <Database size={13} className="db-icon" />
              {dateLabel}
            </span>
            <span className="grounded-lock-badge">
              <ShieldCheck size={12} /> Recorded data
            </span>
          </div>

          <div className="date-pills-row">
            {(['6m', 'month', '30d', '7d', 'today', 'custom'] as DatePreset[]).map(preset => (
              <button
                key={preset}
                type="button"
                className={`context-pill ${datePreset === preset ? 'active' : ''}`}
                onClick={() => setDatePreset(preset)}
              >
                {preset === '6m' ? '6 Months' : preset === 'month' ? 'This Month' : preset === '7d' ? 'Last 7 Days' : preset === '30d' ? 'Last 30 Days' : preset === 'today' ? 'Today' : 'Custom'}
              </button>
            ))}
          </div>

          {datePreset === 'custom' && (
            <div className="custom-date-inputs">
              <div>
                <label>From:</label>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={e => {
                    setStartDate(e.target.value);
                    setDateLabel(`Analyzing: ${e.target.value} to ${endDate} (Asia/Karachi)`);
                  }} 
                />
              </div>
              <div>
                <label>To:</label>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={e => {
                    setEndDate(e.target.value);
                    setDateLabel(`Analyzing: ${startDate} to ${e.target.value} (Asia/Karachi)`);
                  }} 
                />
              </div>
            </div>
          )}
        </div>

        {/* Body View: History vs Chat */}
        {showHistory ? (
          <div className="history-pane">
            <div className="history-header">
              <h3>Previous Questions</h3>
              <button type="button" onClick={loadRuns} disabled={loadingHistory} className="refresh-runs-btn">
                <RefreshCw size={13} className={loadingHistory ? 'spin' : ''} /> Refresh
              </button>
            </div>
            {historyRuns.length === 0 ? (
              <div className="empty-history">No previous questions recorded yet.</div>
            ) : (
              <div className="runs-list">
                {historyRuns.map(run => (
                  <div key={run.id} className="history-run-card">
                    <div className="run-meta">
                      <span className="run-status completed">{run.status}</span>
                      <small>{new Date(run.created_at).toLocaleString('en-PK')}</small>
                    </div>
                    <p className="run-question">"{run.question}"</p>
                    <div className="run-period">
                      Period: {run.period?.start_date} → {run.period?.end_date}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="chat-container">
            {/* Empty State with Starter Prompts */}
            {messages.length === 0 ? (
              <div className="empty-chat-welcome">
                <div className="welcome-icon-box">
                  <Sparkles size={28} />
                </div>
                <h3>Welcome, General Manager</h3>
                <p>
                  Ask any analytical or operational question. Answers are cross-checked with verified dining room orders, kitchen stock, and cashier receipts.
                </p>

                {/* Step 5.3 — Quick Suggested Prompt Chips */}
                <div className="starter-prompts-section">
                  <span className="section-caption">QUICK SUGGESTED INQUIRIES</span>
                  <div className="starter-chips-grid">
                    {STARTER_PROMPTS.map((sp, i) => (
                      <button
                        key={i}
                        type="button"
                        className="starter-prompt-card"
                        onClick={() => handleSend(sp.prompt)}
                      >
                        <div className="prompt-top">
                          <span className="prompt-tag">{sp.tag}</span>
                        </div>
                        <strong className="prompt-title">{sp.title}</strong>
                        <p className="prompt-desc">"{sp.prompt}"</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="messages-list">
                {messages.map(msg => (
                  <div 
                    key={msg.id} 
                    className={`message-bubble-wrapper ${msg.role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="assistant-avatar">
                        <Sparkles size={14} />
                      </div>
                    )}
                    <div className={`message-bubble ${msg.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>
                      <div className="bubble-header">
                        <span className="bubble-author">{msg.role === 'user' ? 'You (Manager)' : 'Smart Dine'}</span>
                        <span className="bubble-time">{msg.timestamp}</span>
                      </div>

                      <div className="bubble-content">
                        {renderMessageContent(msg.content, msg.evidence)}
                      </div>

                      {/* Cited Evidence Badges Footer */}
                      {msg.role === 'assistant' && msg.evidence && msg.evidence.length > 0 && (
                        <div className="bubble-evidence-footer">
                          <span className="evidence-footer-label">Figures used:</span>
                          <div className="evidence-chips-list">
                            {msg.evidence.map(ev => (
                              <button
                                key={ev.id}
                                type="button"
                                onClick={() => setInspectingEvidence(ev)}
                                className="evidence-chip-mini"
                              >
                                <ShieldCheck size={11} />
                                <strong>{ev.id}</strong>: {ev.tool}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Progressive Thinking Indicator */}
                {isThinking && (
                  <div className="thinking-bubble-wrapper">
                    <div className="assistant-avatar pulse">
                      <Sparkles size={14} />
                    </div>
                    <div className="thinking-bubble">
                      <div className="thinking-spinner" />
                      <div className="thinking-text">
                        <strong>Checking your restaurant records…</strong>
                        <small>{thinkingStep}</small>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Step 5.4 — Chat Input & Disclaimer Footer */}
        <footer className="assistant-footer">
          {/* Quick Prompts Bar (when conversation is active) */}
          {messages.length > 0 && !isThinking && (
            <div className="quick-prompts-bar">
              {STARTER_PROMPTS.slice(0, 3).map((sp, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="quick-prompt-pill"
                  onClick={() => handleSend(sp.prompt)}
                >
                  {sp.title}
                </button>
              ))}
            </div>
          )}

          <form 
            className="assistant-input-form"
            onSubmit={e => {
              e.preventDefault();
              handleSend();
            }}
          >
            <textarea
              ref={inputRef}
              value={inputQuery}
              onChange={e => setInputQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask anything about sales, ingredients, margins, or complaints..."
              rows={2}
              maxLength={2000}
              disabled={isThinking}
            />
            <button 
              type="submit" 
              className="send-btn"
              disabled={!inputQuery.trim() || isThinking}
              title="Send Inquiry (Enter)"
            >
              <Send size={16} />
            </button>
          </form>

          {/* Audited Disclaimer Footer */}
          <div className="assistant-disclaimer">
            <ShieldCheck size={12} className="disclaimer-icon" />
            <span>
              Totals come from recorded orders, bills, expenses, stock, and reviews. The assistant only explains them.
            </span>
          </div>
        </footer>

        {/* Evidence Inspector Modal */}
        {inspectingEvidence && (
          <div className="evidence-inspector-overlay" onClick={() => setInspectingEvidence(null)}>
            <div className="evidence-inspector-dialog" onClick={e => e.stopPropagation()}>
              <div className="inspector-head">
                <div className="inspector-title">
                  <ShieldCheck size={18} className="text-emerald" />
                  <div>
                    <h3>Recorded figures [{inspectingEvidence.id}]</h3>
                    <small>Source: <strong>{inspectingEvidence.tool.replaceAll('_',' ')}</strong></small>
                  </div>
                </div>
                <button 
                  type="button" 
                  className="icon-action-btn"
                  onClick={() => setInspectingEvidence(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="inspector-body">
                <div className="inspector-meta-box">
                  <div>
                    <label>Period covered:</label>
                    <p>{inspectingEvidence.temporal_scope || 'Selected reporting period, inclusive.'}</p>
                  </div>
                  {inspectingEvidence.scope_note && (
                    <div>
                      <label>What is included:</label>
                      <p>{inspectingEvidence.scope_note}</p>
                    </div>
                  )}
                </div>

                <div className="inspector-actions-bar">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">Recorded values</span>
                  <button 
                    type="button" 
                    className="copy-json-btn"
                    onClick={() => copyEvidenceJson(inspectingEvidence.data)}
                  >
                    {copiedJson ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
                    {copiedJson ? 'Copied!' : 'Copy figures'}
                  </button>
                </div>

                <div className="evidence-json-viewer"><EvidenceValue value={inspectingEvidence.data}/></div>
              </div>

              <div className="inspector-foot">
                <button 
                  type="button" 
                  className="button gold"
                  onClick={() => setInspectingEvidence(null)}
                >
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
