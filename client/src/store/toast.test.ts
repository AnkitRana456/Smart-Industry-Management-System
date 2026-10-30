import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from './toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const push = (title: string, extra: { keep?: boolean } = {}) => useToasts.getState().push({ tone: 'info', title, ...extra });

describe('toasts', () => {
  it('shows a toast and removes it after six seconds', () => {
    push('Saved');
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['Saved']);
    vi.advanceTimersByTime(5900);
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('can be dismissed early', () => {
    push('One');
    const { id } = useToasts.getState().toasts[0];
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('never stacks more than four on screen, dropping the oldest', () => {
    for (let i = 1; i <= 7; i++) push(`T${i}`);
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['T4', 'T5', 'T6', 'T7']);
  });

  it('keeps ordinary toasts out of the notification center', () => {
    push('Form error');
    expect(useToasts.getState().notices).toHaveLength(0);
  });
});

describe('notification center', () => {
  it('stores kept events newest first, unread', () => {
    push('First', { keep: true });
    push('Second', { keep: true });
    const { notices } = useToasts.getState();
    expect(notices.map((n) => n.title)).toEqual(['Second', 'First']);
    expect(notices.every((n) => !n.read)).toBe(true);
  });

  it('keeps notices after their toast has gone', () => {
    push('Machine offline', { keep: true });
    vi.advanceTimersByTime(7000);
    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(useToasts.getState().notices).toHaveLength(1);
  });

  it('marks everything read, and can clear', () => {
    push('A', { keep: true });
    push('B', { keep: true });
    useToasts.getState().markAllRead();
    expect(useToasts.getState().notices.every((n) => n.read)).toBe(true);
    useToasts.getState().clearNotices();
    expect(useToasts.getState().notices).toHaveLength(0);
  });

  it('holds at most 30 notices', () => {
    for (let i = 0; i < 45; i++) push(`N${i}`, { keep: true });
    const { notices } = useToasts.getState();
    expect(notices).toHaveLength(30);
    expect(notices[0].title).toBe('N44');
  });
});
