import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth, type Role } from '../store/auth';
import { renderWithApp } from '../test/utils';
import AppShell from './AppShell';

const socket = vi.hoisted(() => ({ on: vi.fn(), disconnect: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));

import { io } from 'socket.io-client';

const as = (role: Role) => useAuth.setState({ user: { id: 'u1', name: 'Asha', email: 'a@sims.local', role }, accessToken: 'tok-1', ready: true });

const shell = (route = '/') => renderWithApp(
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<p>Home</p>} />
      <Route path="/machines" element={<p>Machines page</p>} />
    </Route>
    <Route path="/login" element={<p>Login page</p>} />
  </Routes>,
  { route },
);

/** Links inside the always-present desktop sidebar. */
const sidebarLinks = () => within(document.querySelector('aside')!).getAllByRole('link').map((a) => a.textContent);

beforeEach(() => {
  vi.mocked(io).mockClear();
  socket.on.mockClear();
  socket.disconnect.mockClear();
});

describe('navigation by role', () => {
  it('gives admins and managers every page, including Users', () => {
    as('admin');
    shell();
    expect(sidebarLinks()).toEqual(['Dashboard', 'Machines', 'Workers', 'Production', 'Inventory', 'Purchasing', 'Maintenance', 'Handover', 'Analytics', 'AI Analyst', 'Alerts', 'Users']);
  });

  it('gives managers the same pages', () => {
    as('manager');
    shell();
    expect(sidebarLinks()).toContain('AI Analyst');
    expect(sidebarLinks()).toContain('Users');
  });

  it('hides staff-only pages from workers and calls their page "My day"', () => {
    as('worker');
    shell();
    const links = sidebarLinks();
    expect(links).toEqual(['Machines', 'My day', 'Production', 'Inventory', 'Maintenance', 'Handover', 'Alerts']);
    for (const hidden of ['Dashboard', 'Analytics', 'AI Analyst', 'Users']) expect(links).not.toContain(hidden);
  });

  it('shows the signed-in name and role', () => {
    as('manager');
    shell();
    const side = within(document.querySelector('aside')!);
    expect(side.getByText('Asha')).toBeInTheDocument();
    expect(side.getByText('manager')).toBeInTheDocument();
  });
});

describe('mobile menu', () => {
  it('opens a navigation drawer and closes it with the close button or Escape', async () => {
    as('manager');
    shell();
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('closes after choosing a page and shows that page', async () => {
    as('manager');
    shell();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Navigation' })).getByRole('link', { name: 'Machines' }));
    expect(await screen.findByText('Machines page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('offers the same pages as the desktop sidebar', async () => {
    as('worker');
    shell();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Navigation' }));
    expect(drawer.getAllByRole('link').map((a) => a.textContent)).toEqual(['Machines', 'My day', 'Production', 'Inventory', 'Maintenance', 'Handover', 'Alerts']);
  });
});

describe('account controls', () => {
  it('signs out and returns to the login page', async () => {
    as('manager');
    const logout = vi.fn(async () => useAuth.setState({ user: null, accessToken: null }));
    useAuth.setState({ logout });
    shell();
    await userEvent.click(within(document.querySelector('aside')!).getByRole('button', { name: /Sign out/ }));
    expect(logout).toHaveBeenCalled();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('toggles and remembers the theme', async () => {
    as('manager');
    shell();
    const before = document.documentElement.dataset.theme;
    await userEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(document.documentElement.dataset.theme).not.toBe(before);
    expect(localStorage.getItem('sims-theme')).toBe(document.documentElement.dataset.theme);
  });
});

describe('live connection', () => {
  it('connects the socket with the access token and disconnects on leaving', () => {
    as('manager');
    const { unmount } = shell();
    expect(io).toHaveBeenCalledWith(undefined, expect.objectContaining({ auth: { token: 'tok-1' } }));
    const events = socket.on.mock.calls.map(([name]) => name);
    for (const e of ['machine:statusChanged', 'alert:new', 'order:updated', 'assessment:new', 'ml:scored']) expect(events).toContain(e);
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
