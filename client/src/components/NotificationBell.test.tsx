import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useToasts } from '../store/toast';
import NotificationBell from './NotificationBell';

const notify = (title: string, body?: string) => act(() => useToasts.getState().push({ tone: 'warning', title, body, keep: true }));

describe('NotificationBell', () => {
  it('has no badge when there is nothing new, and says so when opened', async () => {
    render(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText(/Nothing new/)).toBeInTheDocument();
  });

  it('shows an unread count that is announced to screen readers', () => {
    render(<NotificationBell />);
    notify('M-101 is now offline');
    notify('New alert', 'Cutting fluid is low');
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
  });

  it('caps the visible count at 9+', () => {
    render(<NotificationBell />);
    for (let i = 0; i < 12; i++) notify(`Event ${i}`);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('lists events newest first and marks them read when opened', async () => {
    render(<NotificationBell />);
    notify('First event');
    notify('Second event', 'details here');
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Second event');
    expect(items[0]).toHaveTextContent('details here');
    expect(items[1]).toHaveTextContent('First event');
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('closes on Escape and on a click elsewhere', async () => {
    render(<div><NotificationBell /><button>outside</button></div>);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    await userEvent.click(bell);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(bell);
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears everything', async () => {
    render(<NotificationBell />);
    notify('Something');
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText(/Nothing new/)).toBeInTheDocument();
  });
});
