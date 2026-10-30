import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { useToasts } from '../store/toast';

// jsdom lacks a few browser APIs the app touches.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  }),
});
Element.prototype.scrollIntoView = () => undefined;

beforeEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [], notices: [] });
});

afterEach(() => cleanup());
