import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, parseCsv } from './csv';

async function exported(header: string[], rows: (string | number)[][]) {
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  downloadCsv('data.csv', header, rows);
  expect(click).toHaveBeenCalledOnce();
  return blob!.text();
}

afterEach(() => vi.restoreAllMocks());

describe('CSV export', () => {
  it('writes a header and one line per row', async () => {
    expect(await exported(['date', 'minutes'], [['2026-10-28', 45], ['2026-10-29', 0]])).toBe('date,minutes\n2026-10-28,45\n2026-10-29,0');
  });

  it('quotes values containing commas, quotes or line breaks', async () => {
    const text = await exported(['name'], [['Press, large'], ['The "big" one'], ['two\nlines']]);
    expect(text).toBe('name\n"Press, large"\n"The ""big"" one"\n"two\nlines"');
  });

  it('defuses spreadsheet formulas so exported text is never evaluated', async () => {
    const text = await exported(['reason'], [['=HYPERLINK("http://evil")'], ['+1+1'], ['-2'], ['@cmd']]);
    const lines = text.split('\n').slice(1);
    expect(lines.every((l) => /^"?'/.test(l))).toBe(true);
  });

  it('leaves ordinary text and numbers alone, including negative numbers as numbers', async () => {
    expect(await exported(['a', 'b'], [['Tool change', -5]])).toBe('a,b\nTool change,-5');
  });

  it('downloads under the requested file name and releases the object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    downloadCsv('downtime-7d.csv', ['x'], [[1]]);
    expect(name).toBe('downtime-7d.csv');
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});

describe('CSV import parsing', () => {
  it('reads plain rows, quoted commas, doubled quotes and CRLF line ends', () => {
    expect(parseCsv('sku,name\r\nA-1,"Bolt, M8"\r\nA-2,"The ""big"" one"\r\n')).toEqual([['sku', 'name'], ['A-1', 'Bolt, M8'], ['A-2', 'The "big" one']]);
  });

  it('keeps newlines inside quotes, skips blank lines and drops a BOM', () => {
    expect(parseCsv('﻿a,b\n\n"x\ny",z')).toEqual([['a', 'b'], ['x\ny', 'z']]);
  });

  it('reads a last row with no trailing newline and keeps empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });
});
