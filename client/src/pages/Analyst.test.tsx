import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalystAnswer, WeeklySummary } from '../lib/types';
import { apiMock, resetApi, routeGet } from '../test/mockApi';
import { apiError, ok, renderWithApp } from '../test/utils';
import Analyst from './Analyst';

vi.mock('../lib/api', async () => (await import('../test/mockApi')).module);

const answer = (over: Partial<AnalystAnswer> = {}): AnalystAnswer => ({
  answer: 'For the last 7 days: Total downtime 1458 minutes; Most downtime: M-104 207 minutes.',
  reportingPeriod: { start: '2026-10-23T00:00:00Z', end: '2026-10-29T10:00:00Z', timezone: 'Asia/Kolkata' },
  keyFigures: [{ label: 'Total downtime', value: 1458, unit: 'minutes' }, { label: 'Most downtime: M-104', value: 207, unit: 'minutes' }],
  evidence: [{ source: 'getDowntimeSummary', recordCount: 24, asOf: '2026-10-29T10:00:00Z' }],
  limitations: [], needsClarification: false,
  ...over,
});

const weekly = (over: Partial<WeeklySummary> = {}): WeeklySummary => ({
  reportingPeriod: { start: '2026-10-23T00:00:00Z', end: '2026-10-29T10:00:00Z', timezone: 'Asia/Kolkata' },
  summary: 'Downtime totalled 1458 minutes over the last 7 days.', highlights: ['Units produced: 980'],
  keyFigures: [{ label: 'Total downtime', value: 1458, unit: 'minutes' }], verified: true, generatedAt: '2026-10-29T10:00:00Z', cached: false,
  ...over,
});

const configured = () => routeGet({ '/ai/status': { configured: true } });
const ask = async (text: string) => {
  await userEvent.type(screen.getByLabelText('Your question'), text);
  await userEvent.keyboard('{Enter}');
};

beforeEach(() => {
  resetApi();
  configured();
});

describe('configuration', () => {
  it('tells the user how to switch AI on when the server has no key', async () => {
    routeGet({ '/ai/status': { configured: false } });
    renderWithApp(<Analyst />);
    expect(await screen.findByText(/AI is not configured on the server/)).toBeInTheDocument();
    expect(screen.getByText('GEMINI_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeDisabled();
  });

  it('shows no warning when configured', async () => {
    renderWithApp(<Analyst />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/ai/status'));
    expect(screen.queryByText(/not configured/)).not.toBeInTheDocument();
  });
});

describe('asking a question', () => {
  it('starts with suggestions and an empty, disabled send button', () => {
    renderWithApp(<Analyst />);
    expect(screen.getByText('What would you like to know?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Which machine had the most downtime?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
  });

  it('sends the question with the selected preset and shows a grounded answer', async () => {
    apiMock.post.mockResolvedValue(ok(answer()));
    renderWithApp(<Analyst />);
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'THIS_WEEK');
    await ask('Which machine had the most downtime?');

    expect(apiMock.post).toHaveBeenCalledWith('/ai/ask', { question: 'Which machine had the most downtime?', timeRange: { preset: 'THIS_WEEK' } });
    expect(await screen.findByText(/Total downtime 1458 minutes/)).toBeInTheDocument();
    const figures = within(screen.getByRole('list', { name: 'Key figures' }));
    expect(figures.getByText('1,458')).toBeInTheDocument();
    expect(figures.getByText('Most downtime: M-104')).toBeInTheDocument();
    expect(screen.getByText(/Based on Downtime logs \(24 records\)/)).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('does not send with Shift+Enter, and needs at least three characters', async () => {
    renderWithApp(<Analyst />);
    const box = screen.getByLabelText('Your question');
    await userEvent.type(box, 'hi');
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    await userEvent.type(box, ' there{Shift>}{Enter}{/Shift}');
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('sends a suggestion with one click', async () => {
    apiMock.post.mockResolvedValue(ok(answer()));
    renderWithApp(<Analyst />);
    await userEvent.click(screen.getByRole('button', { name: 'Which items are below their reorder level?' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/ai/ask', { question: 'Which items are below their reorder level?', timeRange: { preset: 'LAST_7_DAYS' } }));
  });

  it('shows a clarification request as such, without figures', async () => {
    apiMock.post.mockResolvedValue(ok(answer({ answer: 'Which machine do you mean?', needsClarification: true, keyFigures: [], evidence: [] })));
    renderWithApp(<Analyst />);
    await ask('How is it doing?');
    expect(await screen.findByText('Needs a little more detail')).toBeInTheDocument();
    expect(screen.getByText('Which machine do you mean?')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Key figures' })).not.toBeInTheDocument();
  });

  it('shows the answer\'s limitations', async () => {
    apiMock.post.mockResolvedValue(ok(answer({ limitations: ['Machine status and stock levels are current values, not figures for the selected period.'] })));
    renderWithApp(<Analyst />);
    await ask('What is low on stock?');
    expect(await screen.findByText(/current values, not figures/)).toBeInTheDocument();
  });

  it('shows the error and retries the same question and period', async () => {
    apiMock.post.mockRejectedValueOnce(apiError(503, 'The AI service is unavailable. Please try again shortly.'));
    renderWithApp(<Analyst />);
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'LAST_MONTH');
    await ask('Total downtime?');

    expect(await screen.findByText('Could not answer')).toBeInTheDocument();
    expect(screen.getByText(/The AI service is unavailable/)).toBeInTheDocument();

    apiMock.post.mockResolvedValueOnce(ok(answer()));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
    expect(apiMock.post).toHaveBeenLastCalledWith('/ai/ask', { question: 'Total downtime?', timeRange: { preset: 'LAST_MONTH' } });
    expect(await screen.findByText(/Total downtime 1458 minutes/)).toBeInTheDocument();
    expect(screen.getAllByText('Total downtime?')).toHaveLength(1);
  });

  it('keeps earlier answers on screen when a later question fails', async () => {
    apiMock.post.mockResolvedValueOnce(ok(answer({ answer: 'First answer text.' }))).mockRejectedValueOnce(apiError(429, 'Rate limited'));
    renderWithApp(<Analyst />);
    await ask('First question');
    await screen.findByText('First answer text.');
    await ask('Second question');
    expect(await screen.findByText('Rate limited')).toBeInTheDocument();
    expect(screen.getByText('First answer text.')).toBeInTheDocument();
  });
});

describe('custom date range', () => {
  const choose = async () => {
    renderWithApp(<Analyst />);
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'CUSTOM');
  };

  it('shows two date pickers and blocks sending until the range is valid', async () => {
    await choose();
    const start = screen.getByLabelText('Start date');
    const end = screen.getByLabelText('End date');
    await userEvent.type(screen.getByLabelText('Your question'), 'Downtime in that period?');
    const send = screen.getByRole('button', { name: 'Send question' });
    expect(send).toBeDisabled();
    expect(screen.getByText(/Pick a start and end date/)).toBeInTheDocument();

    await userEvent.type(start, '2026-10-20');
    expect(send).toBeDisabled();
    await userEvent.type(end, '2026-10-18');
    expect(send).toBeDisabled();
  });

  it('sends the dates the way the server expects them', async () => {
    apiMock.post.mockResolvedValue(ok(answer()));
    await choose();
    await userEvent.type(screen.getByLabelText('Start date'), '2026-10-20');
    await userEvent.type(screen.getByLabelText('End date'), '2026-10-26');
    await ask('Downtime in that period?');
    expect(apiMock.post).toHaveBeenCalledWith('/ai/ask', { question: 'Downtime in that period?', timeRange: { startDate: '2026-10-20', endDate: '2026-10-26' } });
    expect(await screen.findByText('2026-10-20 to 2026-10-26')).toBeInTheDocument();
  });

  it('disables suggestions until a custom range is complete', async () => {
    await choose();
    expect(screen.getByRole('button', { name: 'How was attendance?' })).toBeDisabled();
  });
});

describe('weekly summary', () => {
  it('is generated only when asked, because it uses the AI', async () => {
    renderWithApp(<Analyst />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/ai/status'));
    expect(apiMock.get).not.toHaveBeenCalledWith('/ai/weekly-summary', expect.anything());
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeEnabled();
  });

  it('shows the summary, highlights and figures, and labels a saved copy', async () => {
    routeGet({ '/ai/status': { configured: true }, '/ai/weekly-summary': weekly({ cached: true }) });
    renderWithApp(<Analyst />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText(/Downtime totalled 1458 minutes/)).toBeInTheDocument();
    expect(screen.getByText('Units produced: 980')).toBeInTheDocument();
    expect(screen.getByText(/saved copy/)).toBeInTheDocument();
  });

  it('says when the written summary could not be verified', async () => {
    routeGet({ '/ai/status': { configured: true }, '/ai/weekly-summary': weekly({ verified: false }) });
    renderWithApp(<Analyst />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText(/could not be checked against the data/)).toBeInTheDocument();
  });

  it('regenerates on request and shows errors with a retry', async () => {
    routeGet({ '/ai/status': { configured: true }, '/ai/weekly-summary': apiError(503, 'The AI service is unavailable.') });
    renderWithApp(<Analyst />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText('The AI service is unavailable.')).toBeInTheDocument();

    routeGet({ '/ai/status': { configured: true }, '/ai/weekly-summary': weekly() });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Downtime totalled/);

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate summary' }));
    await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith('/ai/weekly-summary', { params: { refresh: 'true' } }));
  });
});
