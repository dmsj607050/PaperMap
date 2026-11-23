export const NAV_ITEMS = [
  ['overview', '总览'], ['library', '论文库'], ['map', '研究地图'],
  ['compare', '论文对比'], ['reading', '阅读工作区'], ['import', '导入中心'],
  ['taxonomy', '分类体系'], ['settings', '数据与设置'],
];

export const MODALITIES = ['URL', 'HTML', 'Screenshot', 'Text', 'Logo', 'Metadata', 'Behavioral'];
export const TASKS = ['钓鱼网页二分类', '品牌识别与目标品牌推断', '视觉仿冒或页面相似性检测', '恶意 URL 检测', '网页意图或行为分析', '开放世界或未知品牌检测', '其他网页安全任务'];
export const ARCHITECTURES = ['Traditional ML', 'CNN-based', 'Sequence-based', 'Transformer-based', 'Graph-based', 'Multimodal', 'Foundation Models', 'Hybrid'];
export const FUSION_STAGES = ['No Fusion', 'Early Fusion', 'Intermediate Fusion', 'Late Fusion'];
export const MECHANISMS = ['Attention Fusion', 'Cross-Attention', 'Alignment', 'Consistency Modeling'];
export const OBJECTIVES = ['Contrastive Learning', 'Classification', 'Self-supervised', 'Other'];
export const CHALLENGES = ['Cross-modal Interaction', 'Cross-modal Consistency', 'Modality Conflict', 'Missing Modality', 'Robustness', 'Generalization', 'Domain Shift', 'Brand Generalization', 'Temporal Generalization', 'Explainability', 'Efficiency', 'Adversarial Robustness'];
export const DEFAULT_DOMAIN_ID = 'phishing-webpage-detection';
export const PHISHING_TAXONOMY = {
  modalities: MODALITIES, tasks: TASKS, architectures: ARCHITECTURES, fusionStages: FUSION_STAGES,
  mechanisms: MECHANISMS, objectives: OBJECTIVES, challenges: CHALLENGES, datasets: [], evaluationSettings: [],
};
export const GENERIC_TAXONOMY = {
  modalities: ['Text', 'Image', 'Audio', 'Video', 'Tabular Data', 'Structured Data', 'Other'],
  tasks: ['Classification', 'Regression', 'Prediction', 'Detection', 'Retrieval', 'Clustering', 'Generation', 'Other'],
  architectures: ['Traditional ML', 'CNN-based', 'Sequence-based', 'Transformer-based', 'Graph-based', 'Foundation Models', 'Hybrid', 'Other'],
  fusionStages: ['Early Fusion', 'Intermediate Fusion', 'Late Fusion', 'Not Applicable'],
  mechanisms: ['Attention', 'Alignment', 'Contrastive Learning', 'Consistency Modeling', 'Other'],
  objectives: ['Classification', 'Regression', 'Contrastive Learning', 'Self-supervised', 'Generative', 'Other'],
  challenges: ['Data Quality', 'Missing Data', 'Generalization', 'Domain Shift', 'Robustness', 'Explainability', 'Efficiency', 'Other'],
  datasets: [], evaluationSettings: [],
};
export const TAXONOMY_GROUPS = [
  ['modalities', '输入模态'], ['tasks', '研究任务'], ['architectures', '模型架构'], ['fusionStages', '融合阶段'],
  ['mechanisms', '交互机制'], ['objectives', '学习目标'], ['challenges', '研究挑战'], ['datasets', '数据集'], ['evaluationSettings', '评估设置'],
];
export const createDefaultDomain = () => ({
  id: DEFAULT_DOMAIN_ID, name: '钓鱼网页检测', description: '钓鱼网页检测与识别研究',
  taxonomy: Object.fromEntries(Object.entries(PHISHING_TAXONOMY).map(([key, values]) => [key, [...values]])),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
export const createResearchDomain = (name, description = '') => ({
  id: crypto.randomUUID(), name: String(name).trim(), description: String(description).trim(),
  taxonomy: Object.fromEntries(Object.entries(GENERIC_TAXONOMY).map(([key, values]) => [key, [...values]])),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
export function normalizeDomain(domain) {
  const fallback = domain?.id === DEFAULT_DOMAIN_ID ? PHISHING_TAXONOMY : GENERIC_TAXONOMY;
  const taxonomy = Object.fromEntries(Object.keys(GENERIC_TAXONOMY).map((key) => [key, Array.isArray(domain?.taxonomy?.[key]) ? [...new Set(domain.taxonomy[key].map((value) => String(value).trim()).filter(Boolean))] : [...fallback[key]]]));
  return { ...createResearchDomain('新研究领域'), ...domain, taxonomy };
}
export const READING_STATES = ['Unread', 'Skimming', 'Reading', 'Completed'];
export const RELATION_TYPES = ['Cites', 'Extends', 'Compares With', 'Similar Method', 'Complementary', 'Contradictory Findings'];
export const DIMENSIONS = [
  ['modalities', '输入模态', 20], ['tasks', '研究任务', 25], ['method', '模型与融合', 25],
  ['experiments', '实验设置', 15], ['text', '标题与摘要', 15],
];

export const emptyPaper = (domainId = DEFAULT_DOMAIN_ID) => ({
  id: crypto.randomUUID(), domainId, title: '', titleZh: '', authors: [], year: '', venue: '', doi: '', publicationUrl: '', abstract: '', abstractZh: '', aiReview: null,
  pdfData: '', pdfName: '', bibtex: '', readingStatus: 'Unread', reproduced: false, verificationStatus: 'Missing',
  modalityRoles: {},
  tags: { modalities: [], tasks: [], architectures: [], fusionStages: [], mechanisms: [], objectives: [], challenges: [], datasets: [], evaluationSettings: [] },
  tagStatus: { modalities: 'Unknown', tasks: 'Unknown', method: 'Unknown', experiments: 'Unknown' },
  analysis: { problem: '', motivation: '', featureExtractors: '', contributions: '', findings: '', limitations: '', personalInsights: '', openQuestions: '' },
  experiments: [], notes: [], evidence: [], relations: [], readingChat: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

export function normalizePaper(paper) {
  const base = emptyPaper();
  return { ...base, ...paper, modalityRoles: { ...base.modalityRoles, ...(paper.modalityRoles || {}) }, tags: { ...base.tags, ...(paper.tags || {}) }, tagStatus: { ...base.tagStatus, ...(paper.tagStatus || {}) }, analysis: { ...base.analysis, ...(paper.analysis || {}) }, experiments: paper.experiments || [], notes: paper.notes || [], evidence: paper.evidence || [], relations: paper.relations || [], readingChat: paper.readingChat || [] };
}

const clean = (s = '') => String(s).toLowerCase().replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
const terms = (s = '') => (clean(s).match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || []).flatMap((token) => {
  if (!/^[\u4e00-\u9fff]+$/.test(token) || token.length < 2) return [token];
  return Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2));
});
const setScore = (a = [], b = []) => {
  const x = new Set(a); const y = new Set(b);
  if (!x.size && !y.size) return null;
  const union = new Set([...x, ...y]).size;
  return union ? [...x].filter((value) => y.has(value)).length / union : null;
};
const sharedValues = (a = [], b = []) => { const right = new Set(b); return [...new Set(a)].filter((value) => right.has(value)); };

function tfidfVectors(papers) {
  const docs = papers.map((p) => terms(`${p.title || ''} ${p.abstract || ''}`));
  const df = new Map();
  docs.forEach((doc) => new Set(doc).forEach((term) => df.set(term, (df.get(term) || 0) + 1)));
  return docs.map((doc) => {
    const tf = new Map(); doc.forEach((term) => tf.set(term, (tf.get(term) || 0) + 1));
    const vector = new Map();
    tf.forEach((count, term) => vector.set(term, (1 + Math.log(count)) * (Math.log((docs.length + 1) / ((df.get(term) || 0) + 1)) + 1)));
    const norm = Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
    vector.forEach((value, key) => vector.set(key, value / (norm || 1)));
    return vector;
  });
}

function cosine(a, b) {
  if (!a.size || !b.size) return null;
  let score = 0; a.forEach((value, term) => { score += value * (b.get(term) || 0); });
  return Math.max(0, Math.min(1, score));
}

export function comparePair(a, b, weights = Object.fromEntries(DIMENSIONS.map(([key, , weight]) => [key, weight])), textVectorById = null) {
  const dimensions = {};
  const overlaps = {};
  const confirmed = (paper, key) => paper.tagStatus?.[key] === 'Confirmed';
  if (confirmed(a, 'modalities') && confirmed(b, 'modalities')) { dimensions.modalities = setScore(a.tags.modalities, b.tags.modalities); overlaps.modalities = sharedValues(a.tags.modalities, b.tags.modalities); }
  if (confirmed(a, 'tasks') && confirmed(b, 'tasks')) { dimensions.tasks = setScore(a.tags.tasks, b.tags.tasks); overlaps.tasks = sharedValues(a.tags.tasks, b.tags.tasks); }
  if (confirmed(a, 'method') && confirmed(b, 'method')) {
    const x = [...a.tags.architectures, ...a.tags.fusionStages, ...a.tags.mechanisms, ...a.tags.objectives, ...a.tags.challenges];
    const y = [...b.tags.architectures, ...b.tags.fusionStages, ...b.tags.mechanisms, ...b.tags.objectives, ...b.tags.challenges];
    dimensions.method = setScore(x, y); overlaps.method = sharedValues(x, y);
  }
  if (confirmed(a, 'experiments') && confirmed(b, 'experiments')) { const x = [...a.tags.datasets, ...a.tags.evaluationSettings]; const y = [...b.tags.datasets, ...b.tags.evaluationSettings]; dimensions.experiments = setScore(x, y); overlaps.experiments = sharedValues(x, y); }
  const ta = terms(`${a.title} ${a.abstract}`); const tb = terms(`${b.title} ${b.abstract}`);
  if (ta.length && tb.length) {
    const [va, vb] = textVectorById ? [textVectorById.get(a.id), textVectorById.get(b.id)] : tfidfVectors([a, b]);
    dimensions.text = va && vb ? cosine(va, vb) : null;
    overlaps.text = sharedValues(ta, tb).slice(0, 8);
  }
  const active = Object.entries(dimensions).filter(([, value]) => value !== null && value !== undefined);
  const availableWeight = active.reduce((sum, [key]) => sum + (Number(weights[key]) || 0), 0);
  const score = availableWeight ? active.reduce((sum, [key, value]) => sum + value * (Number(weights[key]) || 0), 0) / availableWeight : null;
  return { score, coverage: Object.values(weights).reduce((sum, w) => sum + Number(w || 0), 0) ? availableWeight / Object.values(weights).reduce((sum, w) => sum + Number(w || 0), 0) : 0, dimensions, overlaps, availableWeight };
}

export function computeEdges(papers, weights, threshold = 0.55, maxEdges = 3) {
  const candidates = [];
  const textVectors = tfidfVectors(papers);
  const textVectorById = new Map(papers.map((paper, index) => [paper.id, textVectors[index]]));
  for (let i = 0; i < papers.length; i += 1) for (let j = i + 1; j < papers.length; j += 1) {
    const result = comparePair(papers[i], papers[j], weights, textVectorById);
    if (result.score !== null && result.score >= threshold) candidates.push({ source: papers[i].id, target: papers[j].id, ...result, type: 'computed' });
  }
  candidates.sort((a, b) => b.score - a.score);
  const perNode = new Map(); const kept = [];
  candidates.forEach((edge) => {
    if ((perNode.get(edge.source) || 0) < maxEdges || (perNode.get(edge.target) || 0) < maxEdges) {
      kept.push(edge); perNode.set(edge.source, (perNode.get(edge.source) || 0) + 1); perNode.set(edge.target, (perNode.get(edge.target) || 0) + 1);
    }
  });
  papers.forEach((paper) => (paper.relations || []).forEach((relation) => {
    if (papers.some((item) => item.id === relation.targetId) && relation.status === 'Confirmed') kept.push({ source: paper.id, target: relation.targetId, type: 'explicit', relationType: relation.type, explanation: relation.explanation });
  }));
  return kept;
}

function parseBibtexLegacy(raw) {
  const entries = [];
  const re = /@([\w-]+)\s*\{\s*([^,]+)\s*,([\s\S]*?)\n?\s*\}/g;
  let match;
  while ((match = re.exec(raw))) {
    const fields = {};
    const body = match[3];
    const fieldRe = /([\w-]+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"(?:[^"\\]|\\.)*"|[^,\n]+)\s*,?/g;
    let field;
    while ((field = fieldRe.exec(body))) fields[field[1].toLowerCase()] = field[2].trim().replace(/^\{|\}$/g, '').replace(/^"|"$/g, '').replace(/[{}]/g, '').replace(/\\&/g, '&');
    const title = fields.title || '';
    if (!title) continue;
    const paper = emptyPaper();
    paper.title = title; paper.bibtexKey = match[2].trim(); paper.bibtex = match[0];
    paper.authors = (fields.author || fields.editor || '').split(/\s+and\s+/i).map((author) => author.replace(/\s+/g, ' ').trim()).filter(Boolean);
    paper.year = fields.year || ''; paper.venue = fields.journal || fields.booktitle || fields.school || '';
    paper.doi = fields.doi || ''; paper.publicationUrl = fields.url || fields.link || ''; paper.abstract = fields.abstract || '';
    paper.verificationStatus = 'Automatically Extracted';
    entries.push(paper);
  }
  return entries;
}

export function parseBibtex(raw, taxonomy = PHISHING_TAXONOMY, domainId = DEFAULT_DOMAIN_ID) {
  const entries = [];
  const entryPattern = /@([\w-]+)\s*\{/g;
  let match;
  while ((match = entryPattern.exec(raw))) {
    const start = entryPattern.lastIndex;
    let depth = 1; let quoted = false; let escaped = false; let cursor = start;
    for (; cursor < raw.length && depth > 0; cursor += 1) {
      const char = raw[cursor];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    if (depth !== 0) continue;
    const body = raw.slice(start, cursor - 1); const comma = body.indexOf(',');
    if (comma < 0) continue;
    const key = body.slice(0, comma).trim(); const source = body.slice(comma + 1); const fields = {};
    let index = 0;
    while (index < source.length) {
      while (index < source.length && /[\s,]/.test(source[index])) index += 1;
      const fieldStart = index;
      while (index < source.length && /[\w-]/.test(source[index])) index += 1;
      const fieldName = source.slice(fieldStart, index).toLowerCase();
      while (index < source.length && /\s/.test(source[index])) index += 1;
      if (!fieldName || source[index] !== '=') { while (index < source.length && source[index] !== ',') index += 1; continue; }
      index += 1; while (index < source.length && /\s/.test(source[index])) index += 1;
      const opener = source[index]; let value = '';
      if (opener === '{') {
        const valueStart = ++index; let level = 1; let valueEscaped = false;
        while (index < source.length && level > 0) {
          const char = source[index];
          if (valueEscaped) { valueEscaped = false; index += 1; continue; }
          if (char === '\\') { valueEscaped = true; index += 1; continue; }
          if (char === '{') level += 1; else if (char === '}') level -= 1;
          index += 1;
        }
        value = source.slice(valueStart, Math.max(valueStart, index - 1));
      } else if (opener === '"') {
        index += 1; const valueStart = index; let valueEscaped = false;
        while (index < source.length) { const char = source[index]; if (valueEscaped) valueEscaped = false; else if (char === '\\') valueEscaped = true; else if (char === '"') break; index += 1; }
        value = source.slice(valueStart, index); if (source[index] === '"') index += 1;
      } else {
        const valueStart = index; while (index < source.length && source[index] !== ',') index += 1; value = source.slice(valueStart, index).trim();
      }
      fields[fieldName] = value.trim().replace(/[{}]/g, '').replace(/\\&/g, '&');
    }
    const title = fields.title || '';
    if (!title) continue;
    const paper = emptyPaper(domainId);
    paper.title = title; paper.bibtexKey = key; paper.bibtex = raw.slice(match.index, cursor);
    paper.authors = (fields.author || fields.editor || '').split(/\s+and\s+/i).map((author) => author.replace(/\s+/g, ' ').trim()).filter(Boolean);
    paper.year = fields.year || ''; paper.venue = fields.journal || fields.booktitle || fields.school || '';
    paper.doi = fields.doi || ''; paper.publicationUrl = fields.url || fields.link || ''; paper.abstract = fields.abstract || '';
    const keywords = (fields.keywords || '').split(/[;,]/).map((value) => value.trim()).filter(Boolean);
    Object.entries(taxonomy).forEach(([group, labels]) => {
      if (!Array.isArray(paper.tags[group])) return;
      paper.tags[group] = labels.filter((label) => keywords.some((keyword) => keyword.toLowerCase() === label.toLowerCase()));
    });
    ['modalities', 'tasks'].forEach((dimension) => {
      if (paper.tags[dimension].length) paper.tagStatus[dimension] = 'Suggested';
    });
    if (['architectures', 'fusionStages', 'mechanisms', 'objectives'].some((group) => paper.tags[group].length)) paper.tagStatus.method = 'Suggested';
    if (fields.dataset) { paper.tags.datasets = fields.dataset.split(/[;,]/).map((value) => value.trim()).filter(Boolean); paper.tagStatus.experiments = 'Suggested'; }
    paper.verificationStatus = 'Automatically Extracted'; entries.push(paper);
  }
  return entries;
}

export function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
