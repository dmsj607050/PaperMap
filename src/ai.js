async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    throw new Error('无法连接本机 AI 服务。请通过 npm run dev 启动 PhishMap。');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）。`);
  return data;
}

export function getAiStatus() {
  return request('/api/ai/status');
}

export function saveAiKey(key) {
  return request('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key }) });
}

export function deleteAiKey() {
  return request('/api/ai/key', { method: 'DELETE' });
}

export function reviewPaperWithAi(paper, sourceText = '', taxonomy, domainName = '研究') {
  return request('/api/ai/review', {
    method: 'POST',
    body: JSON.stringify({
      paper: {
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        publicationUrl: paper.publicationUrl,
        abstract: paper.abstract,
      },
      bibliography: paper.bibtex || '',
      sourceText,
      taxonomy,
      domainName,
    }),
  });
}

export function askReadingAssistant(payload) {
  return request('/api/ai/reading', { method: 'POST', body: JSON.stringify(payload) });
}
