import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../store/auth';
import { apiError, renderWithApp } from '../test/utils';
import Login from './Login';

const page = () => renderWithApp(
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<p>Dashboard page</p>} />
  </Routes>,
  { route: '/login' },
);

const manager = { id: 'u1', name: 'Manoj', email: 'manager@sims.local', role: 'manager' as const };

beforeEach(() => useAuth.setState({ user: null, accessToken: null, ready: true }));

describe('Login', () => {
  it('offers the demo manager account so a first visit works immediately', () => {
    page();
    expect(screen.getByLabelText('Email')).toHaveValue('manager@sims.local');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('signs in with what was typed and moves to the dashboard', async () => {
    const login = vi.fn(async () => useAuth.setState({ user: manager }));
    useAuth.setState({ login });
    page();
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'admin@sims.local');
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'Password@123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith('admin@sims.local', 'Password@123');
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it('shows the server\'s reason when sign-in fails, and stays on the page', async () => {
    useAuth.setState({ login: vi.fn().mockRejectedValue(apiError(401, 'Invalid email or password')) });
    page();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
  });

  it('disables the button while signing in, so a double click cannot submit twice', async () => {
    let finish!: () => void;
    const login = vi.fn(() => new Promise<void>((r) => { finish = () => { useAuth.setState({ user: manager }); r(); }; }));
    useAuth.setState({ login });
    page();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByText('Dashboard page')).toBeInTheDocument());
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('clears an old error on the next attempt', async () => {
    const login = vi.fn().mockRejectedValueOnce(apiError(401, 'Invalid email or password')).mockImplementationOnce(async () => useAuth.setState({ user: manager }));
    useAuth.setState({ login });
    page();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('skips the form if the user is already signed in', () => {
    useAuth.setState({ user: manager });
    page();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });
});
