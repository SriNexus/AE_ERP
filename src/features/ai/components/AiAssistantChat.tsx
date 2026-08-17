/**
 * AiAssistantChat — AI Assistant Chat Interface (Phase 9D)
 *
 * Provides a chat-style interface for natural language queries
 * to the AI assistant across all Solar EPC domains.
 */

import { useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, AlertCircle, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { useAiAssistant, type AssistantDomain, type ChatMessage } from '../hooks/useAiAssistant';
import { cn } from '../../../utils/cn';

const DOMAIN_LABELS: Record<AssistantDomain, string> = {
  sales: 'Sales Assistant',
  procurement: 'Procurement Assistant',
  projects: 'Project Assistant',
  finance: 'Finance Assistant',
  partners: 'Partner Assistant',
  monitoring: 'Monitoring Assistant',
  audit: 'Audit Assistant',
  loan_applications: 'Loan Applications Assistant',
  universal: 'AI Command Center',
};

const DOMAIN_OPTIONS: { value: AssistantDomain; label: string }[] = [
  { value: 'universal', label: '🌐 Universal' },
  { value: 'sales', label: '💰 Sales' },
  { value: 'procurement', label: '📦 Procurement' },
  { value: 'projects', label: '🏗️ Projects' },
  { value: 'finance', label: '💵 Finance' },
  { value: 'partners', label: '🤝 Partners' },
  { value: 'monitoring', label: '📡 Monitoring' },
  { value: 'loan_applications', label: '🏦 Loan Applications' },
  { value: 'audit', label: '🔍 Audit' },
];

const SUGGESTED_QUERIES: Partial<Record<AssistantDomain, string[]>> = {
  universal: [
    'Show overdue invoices',
    'Which projects are delayed?',
    'Which leads need follow-up?',
    'Predict low stock items',
    'Show top performers',
    'Identify risky projects',
  ],
  sales: [
    'Which leads are hot right now?',
    'Show leads needing follow-up today',
    'What is my conversion rate?',
    'Who are my top sales performers?',
  ],
  procurement: [
    'What products are low in stock?',
    'Predict stockout risks',
    'Which vendors are most reliable?',
    'Show material shortage alerts',
  ],
  projects: [
    'Which projects are delayed?',
    'Show QC bottlenecks',
    'Identify risky projects',
    'Which stages have the most projects?',
  ],
  finance: [
    'Show overdue invoices',
    'What is my cashflow situation?',
    'Which customers owe the most?',
    'Show payment collection trends',
  ],
  partners: [
    'Which partners are top performers?',
    'Predict tier upgrades',
    'Show partner settlement status',
    'Detect unusual partner activity',
  ],
  monitoring: [
    'Which plants are offline?',
    'Show low generation alerts',
    'Which plants need maintenance?',
    'Show generation trends',
  ],
  loan_applications: [
    'Which bank approves fastest?',
    'Which loan applications are delayed?',
    'What is the approval rate this month?',
    'Top performing employee?',
    'Pending payment cases?',
    'Which bank performs best?',
  ],
  audit: [
    'Show most active users today',
    'Any security anomalies?',
    'Top modified modules',
    'Show failed actions',
    'Unauthorized access attempts',
  ],
};

export function AiAssistantChat() {
  const {
    messages, isProcessing, error, domain, setDomain,
    sendMessage, clearMessages, messagesEndRef, isMockMode,
  } = useAiAssistant();

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesEndRef]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = inputRef.current;
    if (!input || !input.value.trim() || isProcessing) return;
    sendMessage(input.value);
    input.value = '';
  };

  const handleSuggestionClick = (query: string) => {
    sendMessage(query);
  };

  return (
    <div className="flex flex-col h-full min-h-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-[var(--color-primary)]" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {DOMAIN_LABELS[domain]}
          </span>
          {isMockMode && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Demo Mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
              title="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Domain Selector */}
      <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] [scrollbar-width:none]">
        {DOMAIN_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDomain(opt.value)}
            className={cn(
              'shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all whitespace-nowrap',
              domain === opt.value
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="h-10 w-10 text-[var(--color-primary)] mb-3 opacity-50" />
            <p className="text-sm font-medium text-[var(--color-text)] mb-1">
              Ask me anything about your ERP data
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
              I can analyze sales, projects, finance, inventory, and more
            </p>
            {/* Suggested queries */}
            <div ref={suggestionsRef} className="flex flex-wrap justify-center gap-2 max-w-md">
              {(SUGGESTED_QUERIES[domain] || SUGGESTED_QUERIES.universal)?.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSuggestionClick(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary)] transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center">
                  <Bot className="h-4 w-4 text-[var(--color-primary)]" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-xl px-4 py-2.5',
                  msg.role === 'user'
                    ? 'bg-[var(--color-primary)] text-white rounded-tr-sm'
                    : 'bg-[var(--color-bg-sunken)] border border-[var(--color-border)] text-[var(--color-text)] rounded-tl-sm',
                )}
              >
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                <p className={cn(
                  'text-[10px] mt-1.5',
                  msg.role === 'user' ? 'text-white/60' : 'text-[var(--color-text-muted)]',
                )}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
              {msg.role === 'user' && (
                <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                  <User className="h-4 w-4 text-white" />
                </div>
              )}
            </div>
          ))
        )}

        {isProcessing && (
          <div className="flex gap-3">
            <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center">
              <Bot className="h-4 w-4 text-[var(--color-primary)]" />
            </div>
            <div className="bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
                <span className="text-sm text-[var(--color-text-muted)]">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-[var(--color-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder={`Ask ${DOMAIN_LABELS[domain]}...`}
            disabled={isProcessing}
            className="flex-1 bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isProcessing}
            className="h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AiAssistantChat;
