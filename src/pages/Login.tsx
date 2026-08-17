import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { auth, firebaseEnv, getFirebaseConfigErrorMessage } from '../lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  User, Lock, Eye, EyeOff,
  Users, Building2, Truck, Wrench, Activity, BarChart3,
  Zap, Shield, Clock,
} from 'lucide-react';
import React from 'react';
import toast from 'react-hot-toast';
import { AuthIdentityError, resolveAuthenticatedErpUser } from '../lib/authIdentity';
import { profileToAppUser } from '../lib/userProfile';
import { createOwnerAppIdentity, isOwnerEmail } from '../lib/ownerAccess';
import { isOfficialDemoEmail } from '../config/demo';
import { isDemoSeeded, markDemoSeeded, triggerDemoReset } from '../lib/sandboxReset';
import { queryClient } from '../lib/queryClient';

import loginBgLight from '../assets/login/login-bg-light.jpg';
import loginBgDark from '../assets/login/login-bg-dark.jpg';
import { startDemoSession } from '../lib/demoSession';
import { DEMO_LOGO_URLS } from '../config/demoCompany';

/* ═══════════════════════════════════════════════════════════
   Data
   ═══════════════════════════════════════════════════════════ */

const FEATURES = [
  { icon: Users,      label: 'Lead Management' },
  { icon: Building2,  label: 'Project Management' },
  { icon: Truck,      label: 'Inventory & Dispatch' },
  { icon: Wrench,     label: 'AMC & Service' },
  { icon: Activity,   label: 'Real-time Monitoring' },
  { icon: BarChart3,  label: 'Reports & Analytics' },
] as const;

const STATS = [
  { icon: Users,  value: '1000+', label: 'Installations Managed' },
  { icon: Zap,    value: '500+',  label: 'Active Customers' },
  { icon: Shield, value: '99.9%', label: 'System Uptime' },
  { icon: Clock,  value: '24/7',  label: 'Access Anywhere' },
] as const;

/* ═══════════════════════════════════════════════════════════
   Full-Viewport Background Layer
   
   The background image covers the ENTIRE viewport as a single
   continuous composition. Both the hero area and the login card
   area sit above the SAME image. There is no panel split, no
   separate background color, no per-panel gradient overlay, and
   no hard edge of any kind.
   
   To replace the background image: just swap the files in
   src/assets/login/*.jpg — zero code changes required.
   
   The overlay system:
     1. Upper-left radial highlight — keeps the hero content area lively
     2. Subtle right-side atmospheric glow — naturally illuminates the
        login card area so it feels intentionally lit, not empty
     3. Full-viewport vignette — ensures text stays legible everywhere
     4. No per-panel overlays — both sides of the screen get IDENTICAL
        image treatment so the composition feels like one continuous frame
   ═══════════════════════════════════════════════════════════ */

type BgLayer = { image: string; css: string; isDark: boolean };

function buildBgLayer(src: string, isDark: boolean): BgLayer {
  const vignette = isDark ? '0.46' : '0.26';
  const vignetteMid = Number(vignette) * 0.48;
  return {
    image: src,
    css: [
      // Upper-left fill light — keeps hero content area lively (light mode: slightly reduced for better contrast)
      `radial-gradient(100% 80% at 18% 12%, rgba(255,255,255,${isDark ? 0.05 : 0.10}) 0%, rgba(255,255,255,0) 60%)`,
      // Subtle right-side atmospheric glow — illuminates login card area
      `radial-gradient(70% 50% at 80% 40%, rgba(255,255,255,${isDark ? 0.02 : 0.04}) 0%, transparent 56%)`,
      // Full-viewport vignette — ensures text readability everywhere
      `linear-gradient(180deg, rgba(0,0,0,${vignette}) 0%, rgba(0,0,0,${vignetteMid}) 40%, rgba(0,0,0,${Number(vignette) * 1.4}) 100%)`,
      `url(${src})`,
    ].join(', '),
    isDark,
  };
}

function useBackgroundLayer(): BgLayer {
  const [layer, setLayer] = useState<BgLayer>(() => {
    const dark = document.documentElement.classList.contains('dark');
    return buildBgLayer(dark ? loginBgDark : loginBgLight, dark);
  });

  useEffect(() => {
    const sync = () => {
      const dark = document.documentElement.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark';
      setLayer(buildBgLayer(dark ? loginBgDark : loginBgLight, dark));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);

  return layer;
}

/* ═══════════════════════════════════════════════════════════
   Components
   ═══════════════════════════════════════════════════════════ */

function BrandLogo({ isDark }: { isDark: boolean }) {
  // Uses `isDark` prop from the parent's `useBackgroundLayer()` hook
  // — no duplicate MutationObserver needed. Separate light/dark full
  // logos, never Company Settings.
  return (
    <img
      src={isDark ? DEMO_LOGO_URLS.logoDark : DEMO_LOGO_URLS.logoLight}
      alt="Neozy Demo"
      className="h-[clamp(40px,5.5vh,66px)] w-auto max-w-[clamp(140px,18vw,240px)] xl:h-[clamp(44px,6vh,76px)] xl:max-w-[clamp(160px,20vw,300px)] object-contain select-none drop-shadow-lg"
      style={{ animation: 'login-logo-fade 0.5s ease-out both' }}
      draggable={false}
    />
  );
}

/* ── Shared inner components ────────────────────────────── */

const FormFields = ({ email, password, showPass, loading, disabled, setEmail, setPassword, setShowPass }: {
  email: string; password: string; showPass: boolean; loading: boolean; disabled?: boolean;
  setEmail: (v: string) => void; setPassword: (v: string) => void; setShowPass: (v: boolean) => void;
}) => (
  <>
    <div>
      <label htmlFor="login-email" className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">
        Email Address
      </label>
      <div className="relative">
        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)] pointer-events-none" aria-hidden />
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className="w-full pl-10 pr-4 py-3 border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-xl bg-white/70 dark:bg-[#0b1220]/60 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-primary)]/12 focus:border-[var(--color-primary)] focus-visible:ring-[var(--color-focus-ring)]/30 transition-all duration-200 text-sm shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]"
          required
        />
      </div>
    </div>

    <div>
      <label htmlFor="login-password" className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">
        Password
      </label>
      <div className="relative">
        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)] pointer-events-none" aria-hidden />
        <input
          id="login-password"
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
          className="w-full pl-10 pr-10 py-3 border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-xl bg-white/70 dark:bg-[#0b1220]/60 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-primary)]/12 focus:border-[var(--color-primary)] focus-visible:ring-[var(--color-focus-ring)]/30 transition-all duration-200 text-sm shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]"
          required
        />
        <button
          type="button"
          onClick={() => setShowPass(!showPass)}
          aria-label={showPass ? 'Hide password' : 'Show password'}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>

    <div className="flex items-center justify-between pt-0.5">
      <label className="group flex items-center gap-2.5 cursor-pointer select-none focus-visible:outline-none">
        <input type="checkbox" className="peer sr-only" />
        <div className="w-[18px] h-[18px] rounded-md border-2 border-[var(--color-border-strong)] bg-white/60 dark:bg-[#0f172a]/60 flex items-center justify-center transition-all duration-200 group-hover:border-[var(--color-primary)]/50 group-hover:bg-[var(--color-primary)]/5 peer-checked:bg-[var(--color-primary)] peer-checked:border-[var(--color-primary)] peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--color-focus-ring)]/20" aria-hidden="true">
          <svg className="w-[10px] h-[10px] text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] transition-colors duration-200">Remember me</span>
      </label>
      <button
        type="button"
        onClick={(e) => e.preventDefault()}
        className="text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]/40 focus-visible:ring-offset-1 rounded-sm"
        tabIndex={0}
      >
        Forgot Password?
      </button>
    </div>

    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full py-3.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-focus-ring)]/25 focus-visible:ring-offset-2"
      style={{
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 8px 16px -4px color-mix(in srgb, var(--color-primary) 45%, transparent), 0 2px 6px -1px color-mix(in srgb, var(--color-primary) 35%, transparent)',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {loading && <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" role="status" />}
      {loading ? 'Signing in...' : disabled ? 'Please wait…' : 'Sign In'}
    </button>
  </>
);

const SocialButtons = () => (
  <div className="grid grid-cols-2 gap-3">
    <button
      type="button"
      onClick={(e) => e.preventDefault()}
      aria-label="Sign in with Google"
      className="flex items-center justify-center gap-2.5 py-2.5 border border-[var(--color-border)] rounded-xl text-sm font-medium text-[var(--color-text-secondary)] bg-white/70 dark:bg-[#0b1220]/60 hover:bg-white dark:hover:bg-[#151f32] hover:border-[var(--color-border-strong)] hover:-translate-y-px hover:shadow-[0_6px_16px_-4px_rgba(15,23,42,0.12),0_1px_1px_rgba(15,23,42,0.04)] active:translate-y-0 active:scale-[0.97] transition-all duration-[250ms] ease-out shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-focus-ring)]/20"
    >
      <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      <span>Google</span>
    </button>
    <button
      type="button"
      onClick={(e) => e.preventDefault()}
      aria-label="Sign in with Microsoft"
      className="flex items-center justify-center gap-2.5 py-2.5 border border-[var(--color-border)] rounded-xl text-sm font-medium text-[var(--color-text-secondary)] bg-white/70 dark:bg-[#0b1220]/60 hover:bg-white dark:hover:bg-[#151f32] hover:border-[var(--color-border-strong)] hover:-translate-y-px hover:shadow-[0_6px_16px_-4px_rgba(15,23,42,0.12),0_1px_1px_rgba(15,23,42,0.04)] active:translate-y-0 active:scale-[0.97] transition-all duration-[250ms] ease-out shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-focus-ring)]/20"
    >
      <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="1" y="1" width="10.5" height="10.5" rx="1" fill="#F25022"/>
        <rect x="12.5" y="1" width="10.5" height="10.5" rx="1" fill="#7FBA00"/>
        <rect x="1" y="12.5" width="10.5" height="10.5" rx="1" fill="#00A4EF"/>
        <rect x="12.5" y="12.5" width="10.5" height="10.5" rx="1" fill="#FFB900"/>
      </svg>
      <span>Microsoft</span>
    </button>
  </div>
);

/* ═══════════════════════════════════════════════════════════
   Login Page
   ═══════════════════════════════════════════════════════════ */

export default function Login() {
  const { setUser, setActiveCompanyId } = useAppStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Client-side cooldown after Firebase Auth explicitly throttles this client
  // (auth/too-many-requests) — prevents immediately hammering Firebase again
  // with another sign-in attempt while the throttle is still in effect.
  const [authThrottled, setAuthThrottled] = useState(false);
  const bgLayer = useBackgroundLayer();

  /* ── Auth handlers (preserved from original) ────────── */

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    // Guards duplicate submission beyond the disabled-button case (e.g. a
    // stray Enter-key submit while a request is already in flight or during
    // an active throttle cooldown) — the app must never issue a second
    // signInWithEmailAndPassword call while one is already outstanding.
    if (loading || authThrottled) return;
    setLoading(true);
    setError('');

    try {
      const userEmail = email.toLowerCase();

      if (!firebaseEnv.isConfigured) {
        setError(getFirebaseConfigErrorMessage());
        setLoading(false);
        return;
      }

      const authResult = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = authResult.user;

      if (isOwnerEmail(firebaseUser.email)) {
        // Root-cause fix (homepage demo-data isolation): the Owner identity must
        // NOT inherit the persisted activeCompanyId — a previous demo session
        // leaves 'company-demo-neozy' in the store, which used to point the
        // Owner/Super-Admin homepage at the demo company. Start neutral
        // ('default') and let useGlobalBoot resolve the real default company.
        setActiveCompanyId('default');
        setUser(createOwnerAppIdentity(firebaseUser.uid, 'default'));
        navigate('/');
        return;
      }

      if (isOfficialDemoEmail(firebaseUser.email)) {
        // Start demo session timer (handles idle timeout + 6h expiry)
        startDemoSession();

        if (!isDemoSeeded()) {
          toast.loading('Initializing demo environment...', { duration: 30000 });
          const success = await triggerDemoReset();
          toast.dismiss();
          if (success) {
            markDemoSeeded();
            // Any query cached before this reset (e.g. a prior demo session
            // in the same tab) must not survive it — otherwise a component
            // could render pre-reset data until its own staleTime/gcTime
            // happens to expire, even though Firestore itself is now correct.
            queryClient.clear();
          }
          else toast.error('Demo environment initialization failed. Some features may be unavailable.');
        }
      }

      const match = await resolveAuthenticatedErpUser(firebaseUser);

      if (match) {
        const status = match.status || 'Active';
        if (status === 'Inactive' || status === 'Suspended') {
          await auth.signOut();
          setError('Your account has been deactivated. Please contact an administrator.');
          setLoading(false);
          return;
        }
        const appUser = profileToAppUser({
          id: match.id || firebaseUser.uid,
          name: String(match.name || match.displayName || 'User'),
          displayName: String(match.displayName || match.name || 'User'),
          email: String(match.email || userEmail),
          phone: String(match.phone || ''),
          role: String(match.role || 'Sales'),
          // No 'default' fallback: match.companyId is guaranteed non-empty by the
          // identity resolver's validateProfile, and an authenticated user must
          // never be pinned to the neutral 'default' placeholder (Admin
          // companyId='default' 403-storm root cause). An empty value fails
          // closed in the tenant-scoped query layer instead.
          companyId: String(match.companyId || ''),
          avatarUrl: typeof match.avatarUrl === 'string' ? match.avatarUrl : typeof match.avatar === 'string' ? match.avatar : undefined,
          signatureUrl: typeof match.signatureUrl === 'string' ? match.signatureUrl : typeof match.signature === 'string' ? match.signature : undefined,
          status: typeof match.status === 'string' ? match.status : undefined,
          isSuperAdmin: match.isSuperAdmin === true,
        });
        setActiveCompanyId(appUser.companyId);
        setUser(appUser);
        navigate('/');
      } else {
        await auth.signOut();
        setError('Your account is not configured in the ERP system. Contact an administrator.');
      }
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password.');
      } else if (err.code === 'auth/too-many-requests') {
        // Firebase has explicitly throttled this client — this is Firebase's
        // own rate limit, not an application retry loop (the app never
        // auto-retries a failed sign-in). Do not hammer it again immediately:
        // apply a short client-side cooldown and show a plain-language
        // message instead of the raw Firebase error text.
        setError('Too many sign-in attempts. Please wait about 30 seconds and try again.');
        setAuthThrottled(true);
        window.setTimeout(() => setAuthThrottled(false), 30000);
      } else if (err instanceof AuthIdentityError) {
        await auth.signOut();
        setError(err.message);
      } else {
        setError(err.message || 'Failed to sign in.');
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── Auth alert / error shared block ────────────────── */

  const AuthAlert = ({ children, type }: { children: React.ReactNode; type: 'warning' | 'error' }) => {
    const styles = {
      warning: 'bg-[var(--color-warning-light)] border-[var(--color-warning)]/40 text-[var(--color-warning-text)]',
      error: 'bg-[var(--color-danger-light)] border-[var(--color-danger)]/40 text-[var(--color-danger-text)]',
    };
    return (
      <div className={`mb-4 p-3 border rounded-xl text-sm ${styles[type]}`} role="alert">
        {children}
      </div>
    );
  };

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div
      className="h-dvh flex overflow-hidden"
      style={{ backgroundImage: bgLayer.css, backgroundSize: 'cover', backgroundPosition: 'center' }}
    >

      {/* ═══════════════════════════════════════════════════
          DESKTOP (lg+)
          ═══════════════════════════════════════════════════ */}
      <div className="hidden lg:flex w-full h-full relative">

        {/* ── LEFT PANEL (58%) — no per-panel gradient overlay
             The shared buildBgLayer applies uniform treatment across
             the full viewport, so both sides see the identical image.
             
             Uses overflow-y-auto + scrollbar-gutter:stable so the content
             scrolls gracefully on short viewports instead of cropping.
             Min-h-0 allows flex shrink to prevent flex overflow. */}
        <div className="relative w-[58%] h-full flex flex-col items-center justify-center select-none overflow-y-auto min-h-0 [scrollbar-gutter:stable]">

          {/* Content wrapper with responsive padding — scales with viewport height */}
          <div className="relative z-10 w-full max-w-[620px] px-[clamp(1.5rem,5vw,2.5rem)] 2xl:px-14 py-[clamp(1.5rem,4vh,3rem)]">

            {/* Logo — centered, with responsive bottom spacing */}
            <div className="flex justify-center mb-[clamp(0.75rem,2.5vh,2.5rem)]">
              <BrandLogo isDark={bgLayer.isDark} />
            </div>

            {/* Hero — refined typography with responsive sizing */}
            <div className="text-center mb-[clamp(0.75rem,2.5vh,2.5rem)]" style={{ animation: 'login-fade-up 0.6s ease-out both', animationDelay: '0.1s' }}>
              <h1 className="text-[clamp(1.35rem,3.2vw,2.75rem)] font-bold text-white leading-[1.15] tracking-tight drop-shadow-md select-none">
                Welcome to{' '}
                <span className="bg-gradient-to-r from-indigo-200 via-indigo-100 to-purple-200 bg-clip-text text-transparent font-extrabold">
                  Neozy
                </span>
              </h1>
              <p className="mt-[clamp(0.5rem,1vh,0.75rem)] text-[clamp(0.75rem,1.1vw,1rem)] text-white/80 font-medium tracking-[0.01em]">
                The Complete Solar EPC Management System
              </p>
            </div>

            {/* Feature Pills — premium cards with responsive sizing */}
            <div className="grid grid-cols-3 gap-[clamp(0.625rem,1.2vw,0.875rem)] mb-[clamp(0.625rem,2vh,2.25rem)]" style={{ animation: 'login-fade-up 0.6s ease-out both', animationDelay: '0.2s' }}>
              {FEATURES.map((f) => (
                <div
                  key={f.label}
                  className="group flex flex-col items-center gap-[clamp(0.375rem,1vh,0.625rem)] px-3 py-[clamp(0.75rem,2vh,1.25rem)] rounded-2xl bg-white/95 dark:bg-white/[0.04] backdrop-blur-[4px] border border-white/45 dark:border-white/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_16px_-6px_rgba(0,0,0,0.10)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_14px_28px_-10px_rgba(0,0,0,0.16)] hover:-translate-y-[2px] hover:border-white/75 dark:hover:border-white/18 transition-all duration-400 ease-out"
                >
                  <div className="flex items-center justify-center h-[clamp(2rem,4.5vh,2.5rem)] w-[clamp(2rem,4.5vh,2.5rem)] rounded-xl bg-[var(--color-primary)]/10 group-hover:bg-[var(--color-primary)]/15 group-hover:scale-105 transition-all duration-300">
                    <f.icon className="w-[clamp(0.875rem,2.5vh,1.125rem)] h-[clamp(0.875rem,2.5vh,1.125rem)] text-[var(--color-primary)] group-hover:scale-105 transition-transform duration-200" strokeWidth={2.4} aria-hidden />
                  </div>
                  <span className="text-[clamp(0.625rem,1vh,0.75rem)] font-semibold text-slate-700 dark:text-white/90 text-center leading-tight tracking-wide">{f.label}</span>
                </div>
              ))}
            </div>

            {/* Stats — premium KPI widgets with reduced visual weight */}
            <div className="grid grid-cols-4 gap-[clamp(0.5rem,1vw,1rem)]" style={{ animation: 'login-fade-up 0.6s ease-out both', animationDelay: '0.3s' }}>
              {STATS.map((s) => (
                <div
                  key={s.label}
                  className="text-center px-[clamp(0.375rem,0.8vw,0.5rem)] py-[clamp(0.5rem,1.5vh,1.125rem)] rounded-2xl bg-white/[0.08] backdrop-blur-[4px] border border-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_20px_-12px_rgba(0,0,0,0.45)]"
                >
                  <div className="flex items-center justify-center mb-[clamp(0.25rem,0.5vh,0.5rem)]">
                    <div className="flex items-center justify-center h-6 w-6 rounded-lg bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                      <s.icon className="w-3 h-3 text-indigo-200/90" strokeWidth={2.5} aria-hidden />
                    </div>
                  </div>
                  <span className="block text-[clamp(0.875rem,2vh,1.063rem)] font-bold text-white tracking-tight drop-shadow-sm tabular-nums">{s.value}</span>
                  <p className="text-[clamp(0.625rem,0.9vh,0.688rem)] leading-tight text-white/70 mt-[clamp(0.125rem,0.4vh,0.375rem)] font-semibold tracking-wide">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Quote — integrated as a natural part of the hero, with adaptive spacing */}
            <p className="mt-[clamp(0.75rem,2.5vh,2.5rem)] text-center text-white/90 text-[clamp(0.875rem,1.6vw,1.25rem)] font-medium leading-snug drop-shadow-sm tracking-wide" style={{ animation: 'login-fade-up 0.6s ease-out both', animationDelay: '0.4s' }}>
              &ldquo;From enquiry to installation, manage everything in one place.&rdquo;
            </p>
          </div>
        </div>

        {/* ── RIGHT PANEL (42%) ────────────────────────── */}
        <div className="relative w-[42%] h-full flex items-center justify-center p-[clamp(1rem,3vh,2.5rem)] xl:p-10 overflow-y-auto min-h-0">
          <div className="relative z-10 w-[clamp(340px,30vw,420px)] max-w-full">

            {/* Premium Login Card — sits directly on the shared background image */}
            <div
              className="rounded-[28px] bg-white/92 dark:bg-[#0c1425]/90 backdrop-blur-md border transition-all duration-300"
              style={{
                padding: 'clamp(1.25rem,3vh,2rem) clamp(1.25rem,3vw,2.25rem)',
                borderColor: bgLayer.isDark
                  ? 'rgba(255,255,255,0.05)'
                  : 'rgba(255,255,255,0.45)',
                boxShadow: bgLayer.isDark
                  ? [
                      '0 1px 0 rgba(255,255,255,0.03)',
                      '0 6px 16px rgba(0,0,0,0.20)',
                      '0 20px 40px -8px rgba(0,0,0,0.40)',
                      '0 45px 90px -20px rgba(0,0,0,0.50)',
                      'inset 0 1px 0 rgba(255,255,255,0.03)',
                    ].join(', ')
                  : [
                      '0 1px 2px rgba(15,23,42,0.03)',
                      '0 8px 20px rgba(15,23,42,0.05)',
                      '0 24px 48px -10px rgba(15,23,42,0.12)',
                      '0 48px 96px -20px rgba(15,23,42,0.18)',
                      'inset 0 1px 0 rgba(255,255,255,0.65)',
                    ].join(', '),
                animation: 'login-fade-up 0.7s ease-out both',
                animationDelay: '0.15s',
              }}
            >

              {/* Header — responsive spacing */}
              <div className="mb-[clamp(1rem,2vh,1.75rem)]">
                <h2 className="text-[clamp(1.25rem,2.2vw,1.6rem)] leading-[1.2] font-bold text-[var(--color-text)] tracking-tight">Sign in to your account</h2>
                <p className="mt-[clamp(0.375rem,0.5vh,0.625rem)] text-sm text-[var(--color-text-muted)] leading-relaxed">Enter your credentials to continue.</p>
              </div>

              {/* Firebase warning */}
              {!firebaseEnv.isConfigured && (
                <AuthAlert type="warning">
                  <p className="font-semibold">⚠ Missing Configuration</p>
                  <ul className="list-disc pl-4 mt-1">{firebaseEnv.missingKeys.map((k) => <li key={k}>{k}</li>)}</ul>
                </AuthAlert>
              )}

              {/* Error */}
              {error && (
                <AuthAlert type="error">
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--color-danger)]/10 flex items-center justify-center text-xs font-bold text-[var(--color-danger)] mt-0.5" aria-hidden>!</span>
                    <span>{error}</span>
                  </div>
                </AuthAlert>
              )}

              {/* Form */}
              <form onSubmit={handleLogin} className="space-y-4.5" noValidate>
                <FormFields
                  email={email}
                  password={password}
                  showPass={showPass}
                  loading={loading}
                  disabled={authThrottled}
                  setEmail={setEmail}
                  setPassword={setPassword}
                  setShowPass={setShowPass}
                />
              </form>

              {/* Divider */}
              <div className="relative my-[clamp(1rem,2vh,1.75rem)]" role="separator" aria-orientation="horizontal">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--color-border)]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white/92 dark:bg-[#0c1425]/90 px-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">or continue with</span>
                </div>
              </div>

              <SocialButtons />

              {/* Contact administrator */}
              <p className="mt-[clamp(1rem,1.5vh,1.5rem)] text-center text-sm text-[var(--color-text-muted)]">
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={(e) => e.preventDefault()}
                  className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]/40 focus-visible:ring-offset-1 rounded-sm"
                >
                  Contact your administrator
                </button>
              </p>

              {/* Footer */}
              <div className="mt-[clamp(1rem,1.8vh,1.75rem)] pt-[clamp(0.75rem,1vh,1.125rem)] border-t border-[var(--color-border)]/50">
                <div className="flex items-center justify-center gap-2.5 text-xs text-[var(--color-text-muted)]">
                  <Shield className="w-3.5 h-3.5" aria-hidden />
                  <span className="font-medium tracking-wide">Secure</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border-strong)]" aria-hidden />
                  <span className="font-medium tracking-wide">Reliable</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border-strong)]" aria-hidden />
                  <span className="font-medium tracking-wide">Built for Solar Businesses</span>
                </div>
              </div>
            </div>

            {/* Copyright */}
            <p className="text-center text-xs text-[var(--color-text-muted)] mt-[clamp(0.75rem,1.5vh,1.5rem)]">
              {'\u00A9'} {new Date().getFullYear()} Neozy. All rights reserved.
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          MOBILE (< lg)
          ═══════════════════════════════════════════════════ */}
      <div
        className="flex lg:hidden h-full w-full relative"
        style={{ backgroundImage: bgLayer.css, backgroundSize: 'cover', backgroundPosition: '28% center' }}
      >
        {/* Depth gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20 pointer-events-none" />

        {/* Content — vertically centered, scrollable on short screens */}
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center px-5 py-[clamp(0.75rem,3vh,1.5rem)] overflow-y-auto min-h-0">
          <div className="w-full max-w-sm">

            {/* Logo — responsive spacing */}
            <div className="flex justify-center mb-[clamp(0.5rem,2vh,1rem)]">
              <BrandLogo isDark={bgLayer.isDark} />
            </div>

            {/* Welcome heading */}
            <p className="text-center text-base text-white/90 font-medium mb-[clamp(0.75rem,2vh,1.5rem)] drop-shadow-sm">
              Welcome to Neozy
            </p>

            {/* Floating glass card with improved frosted effect */}              <div
              className="rounded-[26px] bg-white/92 dark:bg-[#0c1425]/92 backdrop-blur-xl border p-[clamp(1rem,2.5vh,1.25rem)] transition-all duration-300"
              style={{
                borderColor: 'rgba(255,255,255,0.35)',
                boxShadow: bgLayer.isDark
                  ? '0 1px 0 rgba(255,255,255,0.03), 0 24px 48px -12px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)'
                  : '0 1px 1px rgba(15,23,42,0.03), 0 24px 48px -12px rgba(15,23,42,0.22), inset 0 1px 0 rgba(255,255,255,0.6)',
                animation: 'login-fade-up 0.6s ease-out both',
                animationDelay: '0.1s',
              }}
            >

              {/* Firebase warning (mobile) */}
              {!firebaseEnv.isConfigured && (
                <div className="mb-3 p-2.5 bg-[var(--color-warning-light)] border border-[var(--color-warning)]/40 rounded-xl text-xs text-[var(--color-warning-text)]" role="alert">
                  <p className="font-semibold">⚠ Missing Configuration</p>
                  <ul className="list-disc pl-4 mt-1">{firebaseEnv.missingKeys.map((k) => <li key={k}>{k}</li>)}</ul>
                </div>
              )}

              {/* Error (mobile) */}
              {error && (
                <div className="mb-3 p-2.5 bg-[var(--color-danger-light)] border border-[var(--color-danger)]/40 rounded-xl text-xs text-[var(--color-danger-text)] whitespace-pre-line" role="alert">
                  <div className="flex items-start gap-1.5">
                    <span className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-[var(--color-danger)]/10 flex items-center justify-center text-[10px] font-bold text-[var(--color-danger)] mt-0.5" aria-hidden>!</span>
                    <span>{error}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-3.5" noValidate>
                <FormFields
                  email={email}
                  password={password}
                  showPass={showPass}
                  loading={loading}
                  disabled={authThrottled}
                  setEmail={setEmail}
                  setPassword={setPassword}
                  setShowPass={setShowPass}
                />
              </form>

              <div className="relative my-[clamp(0.75rem,1.5vh,1.25rem)]" role="separator" aria-orientation="horizontal">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--color-border)]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white/92 dark:bg-[#0c1425]/92 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">or continue with</span>
                </div>
              </div>

              <SocialButtons />

              <p className="mt-[clamp(0.75rem,1.5vh,1.25rem)] text-center text-xs text-[var(--color-text-muted)]">
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={(e) => e.preventDefault()}
                  className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]/40 focus-visible:ring-offset-1 rounded-sm"
                >
                  Contact your administrator
                </button>
              </p>

              <div className="mt-[clamp(0.75rem,1.5vh,1.25rem)] pt-[clamp(0.5rem,0.8vh,0.875rem)] border-t border-[var(--color-border)]/50">
                <div className="flex items-center justify-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                  <Shield className="w-3 h-3" aria-hidden />
                  <span className="font-medium tracking-wide">Secure</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border-strong)]" aria-hidden />
                  <span className="font-medium tracking-wide">Reliable</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border-strong)]" aria-hidden />
                  <span className="font-medium tracking-wide">Built for Solar Businesses</span>
                </div>
              </div>
            </div>

            {/* Copyright */}
            <p className="text-center text-[11px] text-white/60 mt-[clamp(0.5rem,1vh,1rem)]">
              {'\u00A9'} {new Date().getFullYear()} Neozy
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
