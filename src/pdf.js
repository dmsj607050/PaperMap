import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfCandidates(file, pageLimit = 4) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let index = 1; index <= Math.min(pdf.numPages, pageLimit); index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const rows = new Map();
    content.items.forEach((item) => {
      const value = item.str?.trim(); if (!value) return;
      const y = Math.round(item.transform?.[5] || 0);
      const row = rows.get(y) || [];
      row.push({ x: item.transform?.[4] || 0, value }); rows.set(y, row);
    });
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.value).join(' ')).join('\n'));
  }
  const text = pages.join('\n').replace(/\s{2,}/g, ' ');
  const lines = pages.flatMap((page) => page.split(/\n|(?<=[.!?])\s{2,}/).map((line) => line.trim())).filter(Boolean);
  const title = lines.find((line) => line.length > 20 && line.length < 220 && !/^(abstract|arxiv|proceedings|doi:|vol\.|https?:)/i.test(line)) || file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  const year = text.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  const abstractMatch = text.match(/\babstract\b[:\s.-]*([\s\S]{80,1400}?)(?:\b(?:index terms|keywords|1\.?\s*introduction|introduction)\b)/i);
  const doi = text.match(/\b10\.\d{4,9}\/[\w.\-/;()]+/i)?.[0]?.replace(/[.,;]+$/, '') || '';
  return { title, year, doi, abstract: abstractMatch?.[1]?.trim() || '', sourceText: text.slice(0, 24_000), pages: pdf.numPages };
}
