/**
 * BranchInput — Self-learning branch input component
 *
 * Features:
 * - Displays branch suggestions as user types (min 2 chars)
 * - Suggestions ranked by usageCount > lastUsedAt > alphabetical
 * - Auto-learns new branches on blur
 * - Duplicate prevention via normalized names
 * - Works with any bank selected via useBankOptions
 *
 * Usage:
 *   <BranchInput bankName={form.bankName} value={form.branch} onChange={v => setForm({...form, branch: v})} />
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useBankOptions, useBranchSuggestions, useLearnBranch } from '../hooks/useBanks';

interface BranchInputProps {
  bankName: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export function BranchInput({ bankName, value, onChange, placeholder = 'Branch name', required, disabled }: BranchInputProps) {
  const { banks } = useBankOptions();
  const selectedBank = banks.find(b => b.bankName === bankName);
  const bankId = selectedBank?.id;

  const [inputValue, setInputValue] = useState(value || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const suggestions = useBranchSuggestions(bankId, inputValue);
  const learnBranch = useLearnBranch();

  // Sync external value changes
  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  // Record branch usage when input loses focus
  const recordUsage = useCallback((name: string) => {
    if (!bankId || !name?.trim()) return;
    learnBranch.mutate({ bankId, branchName: name.trim() });
  }, [bankId, learnBranch]);

  // Handle suggestion selection
  function selectSuggestion(name: string) {
    setInputValue(name);
    onChange(name);
    setShowSuggestions(false);
    recordUsage(name);
  }

  // Handle blur — learn the branch if it's new, close dropdown
  function handleBlur() {
    // Delay to allow suggestion clicks to register
    setTimeout(() => {
      setIsFocused(false);
      setShowSuggestions(false);

      // If user typed something, record it for learning
      if (inputValue?.trim()) {
        recordUsage(inputValue.trim());
      }
    }, 200);
  }

  // Handle input change
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setInputValue(v);
    onChange(v);
    if (v.length >= 2) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }

  // Handle keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Enter' && showSuggestions && suggestions.length > 0) {
      selectSuggestion(suggestions[0].branchName);
      e.preventDefault();
    }
    if (e.key === 'Tab' && inputValue?.trim()) {
      setShowSuggestions(false);
      recordUsage(inputValue.trim());
    }
  }

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleChange}
        onFocus={() => { setIsFocused(true); if (inputValue.length >= 2) setShowSuggestions(true); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled || !bankName}
        className="block w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-focus-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Branch name"
        autoComplete="off"
      />
      {!bankName && (
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] italic">Select a bank first to see branch suggestions</p>
      )}
      {bankName && inputValue.length < 2 && isFocused && (
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] italic">Type at least 2 characters for suggestions</p>
      )}

      {showSuggestions && bankId && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-enterprise-dropdown)]"
        >
          {suggestions.length > 0 ? (                suggestions.map((branch: any) => (
              <button
                key={branch.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); selectSuggestion(branch.branchName); }}
                className="w-full px-4 py-2.5 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] flex items-center justify-between gap-2"
              >
                <span>{branch.branchName}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                  Used {branch.usageCount || 0}x
                </span>
              </button>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">
              {inputValue.trim() ? (
                <span>New branch: <strong className="text-[var(--color-text)]">{inputValue.trim()}</strong> (will be saved)</span>
              ) : (
                'No suggestions'
              )}
            </div>
          )}
        </div>
      )}

      {learnBranch.isPending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
        </span>
      )}
    </div>
  );
}
