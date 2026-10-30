import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useToasts } from '../store/toast';
import { ConfirmDialog, Field, fmtDate, fmtMins, MlBadge, Modal, RiskBadge, StatusBadge, Toaster } from './ui';

describe('formatting', () => {
  it('formats minutes as hours and minutes', () => {
    expect(fmtMins(0)).toBe('0m');
    expect(fmtMins(45)).toBe('45m');
    expect(fmtMins(60)).toBe('1h 0m');
    expect(fmtMins(207)).toBe('3h 27m');
  });

  it('shows a dash for a missing date', () => {
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('2026-10-29T10:00:00Z')).not.toBe('—');
  });
});

describe('badges', () => {
  it('labels machine status', () => {
    render(<StatusBadge status="maintenance" />);
    expect(screen.getByText('maintenance')).toBeInTheDocument();
  });

  it('shows NO DATA for the Gemini risk when there is not enough data', () => {
    render(<RiskBadge risk="INSUFFICIENT_DATA" />);
    expect(screen.getByText('NO DATA')).toBeInTheDocument();
  });

  it('shows the trained model band with a rounded percentage, and says what it is trained on', () => {
    render(<MlBadge risk="High" probability={0.4519} />);
    const badge = screen.getByText('HIGH 45%');
    expect(badge).toHaveAttribute('title', expect.stringContaining('synthetic'));
  });

  it('shows a dash when a machine has not been scored', () => {
    render(<MlBadge />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('omits the percentage when none is given', () => {
    render(<MlBadge risk="Low" />);
    expect(screen.getByText('LOW')).toBeInTheDocument();
  });
});

describe('Modal', () => {
  it('closes from the close button and from a click on the backdrop, but not from inside the dialog', async () => {
    const onClose = vi.fn();
    render(<Modal title="Edit" onClose={onClose}><p>Body</p></Modal>);
    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is announced as a dialog with its title', () => {
    render(<Modal title="Add machine" onClose={() => undefined}>x</Modal>);
    expect(screen.getByRole('dialog', { name: 'Add machine' })).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('ties the label to its input', () => {
    render(<Field label="Name" htmlFor="n"><input id="n" /></Field>);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  const setup = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete M-110?" message="This cannot be undone." onConfirm={onConfirm} onCancel={onCancel} {...props} />);
    return { onConfirm, onCancel };
  };

  it('asks before anything is deleted, and only confirms on the Delete button', async () => {
    const { onConfirm, onCancel } = setup();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('focuses Cancel first so Enter cannot delete by accident', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('disables the destructive button while working and shows server errors', () => {
    setup({ busy: true, error: 'Shift still has workers assigned' });
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Shift still has workers assigned');
  });

  it('supports a custom confirm label', () => {
    setup({ confirmLabel: 'Remove' });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

describe('Toaster', () => {
  it('renders toasts in a polite live region and lets the user dismiss one', async () => {
    render(<Toaster />);
    useToasts.getState().push({ tone: 'critical', title: 'M-104 is now offline', body: 'Welding A' });
    expect(await screen.findByText('M-104 is now offline')).toBeInTheDocument();
    expect(screen.getByText('Welding A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('M-104 is now offline')).not.toBeInTheDocument();
  });
});
