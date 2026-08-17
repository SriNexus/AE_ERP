/**
 * App.tsx — Top-level composition
 *
 * Responsive shell switching: renders the desktop shell (AppRoutes)
 * on viewports >= 1024px and the mobile shell (MobileRoutes) on
 * viewports < 1024px. Both share the same providers, so auth,
 * theme, React Query cache, and Zustand state are unified.
 */
import { AppProviders } from './app/providers';
import { AppRoutes }    from './app/router/routes';
import { MobileRoutes } from './components/mobile/routing/MobileRoutes';
import { useMobileDetect } from './components/mobile/shell/useMobileDetect';

export default function App() {
  const isMobile = useMobileDetect();

  return (
    <AppProviders>
      {isMobile ? <MobileRoutes /> : <AppRoutes />}
    </AppProviders>
  );
}
