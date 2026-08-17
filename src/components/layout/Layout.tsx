/**
 * Layout — protected shell composition
 *
 * Layout — protected shell composition.
 */

import { AppShell }        from '../../app/layouts/AppShell';
import { Sidebar }         from './Sidebar';
import TopBar              from './TopBar';

function Layout() {
  return (
    <AppShell>
      <AppShell.Sidebar>
        <Sidebar />
      </AppShell.Sidebar>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden app-shell__content-col">
        <AppShell.Topbar>
          <TopBar />
        </AppShell.Topbar>
        <AppShell.Main />
      </div>
    </AppShell>
  );
}

export default Layout;
