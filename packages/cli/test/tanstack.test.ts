import { describe, it, expect } from 'vitest';
import { tanstackRoutes } from '../src/discover/tanstack.js';

describe('tanstackRoutes', () => {
  it('maps ListForge-shaped route files', () => {
    const r = tanstackRoutes([
      '__root.tsx',
      'index.tsx',
      'login.tsx',
      '_authenticated/items.index.tsx',
      '_authenticated/items.$itemId.tsx',
      '_authenticated/orders/index.tsx',
      '_authenticated/settings.billing.tsx',
      '_authenticated/-acceptInvitationOrgSync.tsx',
      '_authenticated/-acceptInvitationOrgSync.test.ts',
      '_authenticated/admin/-settings-audit.test.tsx',
      '_authenticated/billing.test.tsx',
    ]);
    expect(r.static).toEqual([
      { id: 'home', route: '/' },
      { id: 'login', route: '/login' },
      { id: 'items', route: '/items' },
      { id: 'orders', route: '/orders' },
      { id: 'settings.billing', route: '/settings/billing' },
    ]);
    expect(r.param).toEqual(['/items/$itemId']);
  });

  it('dedupes routes and skips lazy files', () => {
    const r = tanstackRoutes(['items.tsx', 'items.index.tsx', 'items.lazy.tsx']);
    expect(r.static).toEqual([{ id: 'items', route: '/items' }]);
  });
});
