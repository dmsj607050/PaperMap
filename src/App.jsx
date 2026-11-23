import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, CheckCheck,
  ChevronDown, CircleHelp, Clock3, FileDown, FilePlus2, FileText, Filter, Focus, GitBranch, KeyRound, Layers3,
  LayoutDashboard, Library, Link2, LockKeyhole, Map as MapIcon, Menu, MessageSquareText, Minus, Network, Plus,
  Search, Settings2, Shield, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X,
} from 'lucide-react';
import { getAllPapers, getResearchDomains, removePaper, replaceDomainPapers, savePaper, savePapers, saveResearchDomain } from './db.js';
import {
  DEFAULT_DOMAIN_ID, DIMENSIONS, GENERIC_TAXONOMY, NAV_ITEMS, READING_STATES, RELATION_TYPES, TAXONOMY_GROUPS,
  computeEdges, createResearchDomain, csvEscape, emptyPaper, normalizeDomain, normalizePaper, parseBibtex,
} from './model.js';
import { extractPdfCandidates } from './pdf.js';
import { deleteAiKey, getAiStatus, reviewPaperWithAi, saveAiKey } from './ai.js';

const NAV_ICONS = { overview: LayoutDashboard, library: Library, map: Network, compare: GitBranch, reading: BookOpen, import: FilePlus2, taxonomy: Layers3, settings: Settings2 };
const PRESETS = {
  balanced: { modalities: 20, tasks: 25, method: 25, experiments: 15, text: 15 },
  modality: { modalities: 40, tasks: 15, method: 20, experiments: 10, text: 15 },
  method: { modalities: 10, tasks: 15, method: 45, experiments: 15, text: 15 },
};
const PRESET_LABELS = { balanced: '均衡视角', modality: '模态视角', method: '方法视角' };
function readLocalJson(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; } }
const TAG_STATUS_DIMENSIONS = { modalities: 'modalities', tasks: 'tasks', architectures: 'method', fusionStages: 'method', mechanisms: 'method', objectives: 'method' };
const TAXONOMY_DESCRIPTIONS = {
  modalities: '描述论文使用的数据或信息模态。', tasks: '记录论文试图解决的研究任务。', architectures: '记录模型或系统采用的架构类型。',
  fusionStages: '说明多路信息在哪个阶段整合。', mechanisms: '描述模型内部的交互或对齐机制。', objectives: '记录训练目标或优化目标。',
  challenges: '归纳研究问题或方法面对的挑战。', datasets: '记录论文中使用的数据集。', evaluationSettings: '描述划分方式、泛化设置等评估条件。',
};
const ANALYSIS_FIELDS = [
  ['problem', '研究问题'], ['motivation', '研究动机'], ['featureExtractors', '特征提取方法'], ['contributions', '核心贡献'],
  ['findings', '主要结果'], ['limitations', '局限性'], ['personalInsights', '个人理解'], ['openQuestions', '未解决的问题'],
];
const MATRIX_FIELDS = [
  ['task', '研究任务'], ['modalities', '输入模态'], ['featureExtractors', '特征提取方法'], ['architecture', '模型架构'],
  ['fusion', '融合阶段'], ['mechanism', '交互机制'], ['objective', '训练目标'], ['datasets', '数据集'],
  ['evaluationSettings', '评价设置'], ['metrics', '评价指标'], ['contributions', '核心贡献'], ['limitations', '局限性'],
];
const fmtDate = (date) => date ? new Date(date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const list = (value) => Array.isArray(value) ? value : [];
const cleanText = (value) => String(value ?? '').trim();
const makeDuplicateKey = (paper) => `${cleanText(paper.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}-${paper.year || ''}`;
const normalizeDoi = (value) => cleanText(value).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[\s.]+$/, '');
const sameBibliographicPaper = (a, b) => Boolean((a.doi && b.doi && normalizeDoi(a.doi) === normalizeDoi(b.doi)) || (a.year && cleanText(a.title) && cleanText(b.title) && makeDuplicateKey(a) === makeDuplicateKey(b)));
const dimensionTitle = Object.fromEntries(DIMENSIONS.map(([key, label]) => [key, label]));
const AI_FIELD_LABELS = { title: '标题', authors: '作者', year: '年份', venue: '期刊 / 会议', doi: 'DOI', publicationUrl: '发表页面', abstract: '摘要' };

function applyAiCandidates(paper, result, model, generatedAt, taxonomy) {
  const next = normalizePaper(paper);
  const metadata = result?.metadata || {};
  const discrepancies = [];
  const setCandidate = (key, candidate, format = (value) => String(value || '').trim()) => {
    const value = format(candidate);
    if (!value) return;
    const current = format(next[key]);
    if (!current) next[key] = value;
    else if (current.toLowerCase() !== value.toLowerCase()) discrepancies.push({ field: key, label: AI_FIELD_LABELS[key] || key, current, candidate: value });
  };

  ['title', 'year', 'venue', 'doi', 'publicationUrl', 'abstract'].forEach((key) => setCandidate(key, metadata[key]));
  setCandidate('authors', metadata.authors, (value) => (Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean).join(' | '));
  if (Array.isArray(metadata.authors) && metadata.authors.length && !next.authors.length) next.authors = metadata.authors.map((item) => String(item).trim()).filter(Boolean);
  if (!next.titleZh && metadata.titleZh) next.titleZh = String(metadata.titleZh).trim();
  if (!next.abstractZh && metadata.abstractZh) next.abstractZh = String(metadata.abstractZh).trim();

  const approvedOptions = taxonomy;
  const tagStatusByField = { modalities: 'modalities', tasks: 'tasks', architectures: 'method', fusionStages: 'method', mechanisms: 'method', objectives: 'method', challenges: null, datasets: 'experiments', evaluationSettings: 'experiments' };
  Object.entries(result?.classification || {}).forEach(([key, values]) => {
    if (!Array.isArray(values) || !Array.isArray(next.tags[key])) return;
    const statusKey = tagStatusByField[key];
    if (statusKey && next.tagStatus[statusKey] === 'Confirmed') return;
    const allowed = approvedOptions[key];
    const suggestions = [...new Set(values.map((value) => String(value).trim()).filter((value) => value && (!allowed || allowed.includes(value))))];
    if (!suggestions.length) return;
    next.tags[key] = [...new Set([...next.tags[key], ...suggestions])];
    if (statusKey && next.tagStatus[statusKey] !== 'Confirmed') next.tagStatus[statusKey] = 'Suggested';
  });

  const analysis = result?.analysis || {};
  Object.keys(next.analysis).forEach((key) => {
    const candidate = String(analysis[key] || '').trim();
    if (!next.analysis[key] && candidate) next.analysis[key] = candidate;
  });
  next.aiReview = {
    provider: 'DeepSeek', model, generatedAt,
    evidence: Array.isArray(result?.evidence) ? result.evidence.slice(0, 16).map((item) => ({ field: String(item.field || ''), confidence: String(item.confidence || 'low'), excerpt: String(item.excerpt || '').slice(0, 500) })) : [],
    inconsistencies: Array.isArray(result?.inconsistencies) ? result.inconsistencies.map(String).slice(0, 8) : [],
    notes: Array.isArray(result?.notes) ? result.notes.map(String).slice(0, 8) : [],
    discrepancies,
  };
  next.verificationStatus = 'Automatically Extracted';
  return next;
}

function Badge({ children, tone = 'neutral' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
function EmptyState({ icon: Icon = FileText, title, body, action, onAction }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23} /></div><h3>{title}</h3><p>{body}</p>{action && <button className="button button-dark" onClick={onAction}>{action}</button>}</div>;
}

function App() {
  const [domains, setDomains] = useState([]);
  const [domainsLoaded, setDomainsLoaded] = useState(false);
  const [activeDomainId, setActiveDomainId] = useState(() => readLocalJson('phishmap-active-domain', DEFAULT_DOMAIN_ID));
  const [domainMenuOpen, setDomainMenuOpen] = useState(false);
  const [newDomainOpen, setNewDomainOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainDescription, setNewDomainDescription] = useState('');
  const [prefsLoadedDomain, setPrefsLoadedDomain] = useState('');
  const [papers, setPapers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState('overview');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [activeEdge, setActiveEdge] = useState(null);
  const [editor, setEditor] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [toast, setToast] = useState('');
  const [preset, setPreset] = useState('balanced');
  const [weights, setWeights] = useState(PRESETS.balanced);
  const [threshold, setThreshold] = useState(55);
  const [maxEdges, setMaxEdges] = useState(3);
  const [mapColor, setMapColor] = useState('modalities');
  const [mapTask, setMapTask] = useState('');
  const [mapModality, setMapModality] = useState('');
  const [mapYear, setMapYear] = useState('');
  const [mapRelation, setMapRelation] = useState('both');
  const [mapViewport, setMapViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [libraryFilters, setLibraryFilters] = useState({ status: '', modality: [], task: [], year: '' });
  const [sortBy, setSortBy] = useState('title');
  const [compareIds, setCompareIds] = useState([]);
  const [readingId, setReadingId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [notePage, setNotePage] = useState('');
  const [noteType, setNoteType] = useState('阅读观察');
  const [evidenceDraft, setEvidenceDraft] = useState({ field: 'problem', page: '', quote: '' });
  const [relationDraft, setRelationDraft] = useState({ targetId: '', type: 'Similar Method', explanation: '' });
  const [importQueuesByDomain, setImportQueuesByDomain] = useState({});
  const [importBusy, setImportBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState({ configured: false, model: 'deepseek-flash', reachable: true });
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false);
  const [aiSettingsMessage, setAiSettingsMessage] = useState('');
  const [aiQueueBusyId, setAiQueueBusyId] = useState('');
  const [restoreMode, setRestoreMode] = useState('merge');
  const [mobileNav, setMobileNav] = useState(false);
  const [savedPresets, setSavedPresets] = useState([]);
  const [taxonomyDrafts, setTaxonomyDrafts] = useState({});
  const [onlySelectedTag, setOnlySelectedTag] = useState('');
  const importInput = useRef(null);
  const backupInput = useRef(null);
  const searchInput = useRef(null);
  const mapDrag = useRef(null);
  const importQueue = importQueuesByDomain[activeDomainId] || [];
  const activeDomain = domains.find((domain) => domain.id === activeDomainId) || null;
  const domainTaxonomy = activeDomain?.taxonomy || GENERIC_TAXONOMY;
  const tagGroups = TAXONOMY_GROUPS.map(([key, label]) => [key, label, domainTaxonomy[key] || [], TAG_STATUS_DIMENSIONS[key] || (['datasets', 'evaluationSettings'].includes(key) ? 'experiments' : null)]);
  function setImportQueue(updater) {
    setImportQueuesByDomain((old) => ({ ...old, [activeDomainId]: typeof updater === 'function' ? updater(old[activeDomainId] || []) : updater }));
  }

  useEffect(() => {
    getResearchDomains().then(async (items) => {
      let normalized = items.map(normalizeDomain);
      const defaultDomain = normalized.find((domain) => domain.id === DEFAULT_DOMAIN_ID);
      const legacyTags = readLocalJson('phishmap-custom-tags', []);
      if (defaultDomain && legacyTags.length) {
        const migrated = { ...defaultDomain, taxonomy: { ...defaultDomain.taxonomy, challenges: [...new Set([...defaultDomain.taxonomy.challenges, ...legacyTags])] } };
        await saveResearchDomain(migrated);
        localStorage.removeItem('phishmap-custom-tags');
        normalized = normalized.map((domain) => domain.id === migrated.id ? migrated : domain);
      }
      setDomains(normalized);
      const savedId = readLocalJson('phishmap-active-domain', DEFAULT_DOMAIN_ID);
      setActiveDomainId(normalized.some((domain) => domain.id === savedId) ? savedId : normalized[0]?.id || DEFAULT_DOMAIN_ID);
      setDomainsLoaded(true);
    }).catch(() => { setDomainsLoaded(true); setLoaded(true); flash('本地研究领域数据库无法打开。'); });
  }, []);
  useEffect(() => {
    if (!domainsLoaded || !activeDomainId) return undefined;
    let cancelled = false;
    setLoaded(false);
    getAllPapers(activeDomainId).then((data) => { if (!cancelled) { setPapers(data.map(normalizePaper)); setLoaded(true); } })
      .catch(() => { if (!cancelled) { setPapers([]); setLoaded(true); flash('本地论文数据库无法打开，请检查浏览器的站点存储设置。'); } });
    localStorage.setItem('phishmap-active-domain', activeDomainId);
    setPage('overview'); setSelectedId(''); setActiveEdge(null); setEditor(null); setConflict(null); setCompareIds([]); setReadingId('');
    setLibraryFilters({ status: '', modality: [], task: [], year: '' }); setMapTask(''); setMapModality(''); setMapYear('');
    const legacyPrefs = activeDomainId === DEFAULT_DOMAIN_ID ? readLocalJson('phishmap-map-preferences', {}) : {};
    const prefs = readLocalJson(`phishmap-map-preferences:${activeDomainId}`, legacyPrefs);
    setPreset(prefs.preset || 'balanced'); setWeights(prefs.weights || PRESETS.balanced); setThreshold(prefs.threshold ?? 55); setMaxEdges(prefs.maxEdges ?? 3); setMapColor(prefs.mapColor || 'modalities');
    const legacyPresets = activeDomainId === DEFAULT_DOMAIN_ID ? readLocalJson('phishmap-saved-presets', []) : [];
    setSavedPresets(readLocalJson(`phishmap-saved-presets:${activeDomainId}`, legacyPresets));
    setPrefsLoadedDomain(activeDomainId);
    return () => { cancelled = true; };
  }, [domainsLoaded, activeDomainId]);
  useEffect(() => { getAiStatus().then((status) => setAiStatus({ ...status, reachable: true })).catch(() => setAiStatus({ configured: false, model: 'deepseek-flash', reachable: false })); }, []);
  useEffect(() => { if (papers.length && !readingId) setReadingId(papers[0].id); }, [papers, readingId]);
  useEffect(() => { if (prefsLoadedDomain === activeDomainId) localStorage.setItem(`phishmap-map-preferences:${activeDomainId}`, JSON.stringify({ weights, preset, threshold, maxEdges, mapColor })); }, [weights, preset, threshold, maxEdges, mapColor, activeDomainId, prefsLoadedDomain]);
  useEffect(() => { if (prefsLoadedDomain === activeDomainId) localStorage.setItem(`phishmap-saved-presets:${activeDomainId}`, JSON.stringify(savedPresets)); }, [savedPresets, activeDomainId, prefsLoadedDomain]);
  useEffect(() => { const onKey = (event) => { if (event.key === 'Escape') { setEditor(null); setConflict(null); setMobileNav(false); setDomainMenuOpen(false); setNewDomainOpen(false); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);

  function flash(message) { setToast(message); window.clearTimeout(flash.timer); flash.timer = window.setTimeout(() => setToast(''), 2600); }
  function openCreateDomain() { setDomainMenuOpen(false); setNewDomainName(''); setNewDomainDescription(''); setNewDomainOpen(true); }
  async function createDomain(event) {
    event?.preventDefault();
    const name = newDomainName.trim();
    if (!name) return;
    if (domains.some((domain) => domain.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { flash('已有同名研究领域，请换一个名称。'); return; }
    const domain = createResearchDomain(name, newDomainDescription);
    await saveResearchDomain(domain);
    setDomains((old) => [...old, domain]); setActiveDomainId(domain.id); setNewDomainOpen(false); setPage('overview'); flash(`已创建研究领域「${name}」。`);
  }
  function switchDomain(domainId) {
    if (domainId === activeDomainId) { setDomainMenuOpen(false); return; }
    setDomainMenuOpen(false); setActiveDomainId(domainId); setQuery(''); setOnlySelectedTag(''); setMapViewport({ scale: 1, x: 0, y: 0 });
  }
  async function saveDomainTaxonomy(key, values) {
    if (!activeDomain) return;
    const next = normalizeDomain({ ...activeDomain, taxonomy: { ...activeDomain.taxonomy, [key]: [...new Set(values.map((value) => value.trim()).filter(Boolean))] }, updatedAt: new Date().toISOString() });
    await saveResearchDomain(next); setDomains((old) => old.map((domain) => domain.id === next.id ? next : domain));
  }
  async function storeAiKey(event) {
    event?.preventDefault();
    setAiSettingsBusy(true); setAiSettingsMessage('');
    try { const status = await saveAiKey(aiKeyDraft); setAiStatus({ ...status, reachable: true }); setAiKeyDraft(''); setAiSettingsMessage('密钥已保存在本机 .env.local，AI 功能已启用。'); }
    catch (error) { setAiSettingsMessage(error.message); }
    finally { setAiSettingsBusy(false); }
  }
  async function removeAiKey() {
    setAiSettingsBusy(true); setAiSettingsMessage('');
    try { const status = await deleteAiKey(); setAiStatus({ ...status, reachable: true }); setAiKeyDraft(''); setAiSettingsMessage('本机保存的 DeepSeek 密钥已移除。'); }
    catch (error) { setAiSettingsMessage(error.message); }
    finally { setAiSettingsBusy(false); }
  }
  async function assistPaper(paper) {
    if (!aiStatus.configured) throw new Error('请先在“数据与设置”中配置 DeepSeek API Key。');
    let sourceText = paper.abstract || '';
    if (paper.pdfBlob) {
      const extracted = await extractPdfCandidates(paper.pdfBlob, 8);
      sourceText = [extracted.sourceText, paper.abstract].filter(Boolean).join('\n\n');
    }
    const response = await reviewPaperWithAi(paper, sourceText, domainTaxonomy, activeDomain?.name || '研究');
    return applyAiCandidates(paper, response.result, response.model, response.generatedAt, domainTaxonomy);
  }
  async function assistQueuedPaper(item) {
    setAiQueueBusyId(item.queueId);
    try {
      const paper = await assistPaper(item.paper);
      setImportQueue((queue) => queue.map((entry) => entry.queueId === item.queueId ? { ...entry, paper } : entry));
      flash('AI 候选已填入，请人工校对后再添加。');
    } catch (error) { flash(error.message); }
    finally { setAiQueueBusyId(''); }
  }
  async function persistPaper(paper) {
    const normalized = normalizePaper({ ...paper, domainId: activeDomainId, updatedAt: new Date().toISOString() });
    await savePaper(normalized);
    setPapers((old) => old.some((item) => item.id === normalized.id) ? old.map((item) => item.id === normalized.id ? normalized : item) : [normalized, ...old]);
    return normalized;
  }
  async function persistAll(next) { const scoped = next.map((paper) => normalizePaper({ ...paper, domainId: activeDomainId })); await savePapers(scoped); setPapers(scoped); }
  function openEditor(paper = null, queueId = '') { setEditor({ paper: normalizePaper(paper ? { ...paper, domainId: activeDomainId } : emptyPaper(activeDomainId)), queueId }); }
  function updateDraft(key, value) { setEditor((current) => ({ ...current, paper: { ...current.paper, [key]: value } })); }
  async function submitEditor(event, bypassDuplicate = false) {
    event?.preventDefault();
    const paper = normalizePaper({ ...editor.paper, title: cleanText(editor.paper.title), authors: Array.isArray(editor.paper.authors) ? editor.paper.authors : String(editor.paper.authors || '').split(/[,;]\s*/), year: editor.paper.year ? String(editor.paper.year) : '' });
    if (!paper.title && !paper.pdfBlob && !paper.bibtex) { flash('手动创建记录时请填写标题，或者先关联 PDF / BibTeX。'); return; }
    if (!bypassDuplicate) {
      const queueIndex = editor.queueId ? importQueue.findIndex((item) => item.queueId === editor.queueId) : -1;
      const match = papers.find((item) => item.id !== paper.id && sameBibliographicPaper(item, paper)) || importQueue.slice(0, Math.max(queueIndex, 0)).find((item) => item.queueId !== editor.queueId && sameBibliographicPaper(item.paper, paper))?.paper;
      if (match) { setConflict({ paper, match, queueId: editor.queueId }); return; }
    }
    await persistPaper(paper);
    if (editor.queueId) setImportQueue((queue) => queue.filter((item) => item.queueId !== editor.queueId));
    setSelectedId(paper.id); setEditor(null); setConflict(null); flash('论文记录已保存。');
  }
  async function deleteSelected(paper) {
    if (!window.confirm(`删除“${paper.title}”？此操作会同时删除该论文的 PDF、笔记和证据。`)) return;
    await removePaper(paper.id); setPapers((old) => old.filter((item) => item.id !== paper.id)); setSelectedId(''); flash('论文记录已删除。');
  }
  function changePreset(next) { setPreset(next); setWeights({ ...PRESETS[next] }); }
  function saveWeightPreset() {
    const name = window.prompt('为当前相似度权重预设命名：', '我的研究视角');
    if (!name?.trim()) return;
    const item = { id: crypto.randomUUID(), name: name.trim(), weights: { ...weights } };
    setSavedPresets((old) => [...old.filter((presetItem) => presetItem.name !== item.name), item]); setPreset(item.id); flash('自定义权重预设已保存。');
  }
  function applySavedPreset(item) { setPreset(item.id); setWeights({ ...item.weights }); }
  function changeWeight(key, value) {
    const keys = DIMENSIONS.map(([item]) => item);
    const others = keys.filter((item) => item !== key);
    const oldTotal = others.reduce((sum, item) => sum + Number(weights[item] || 0), 0);
    let remaining = (100 - value) / 5;
    const next = { ...weights, [key]: value };
    others.forEach((item, index) => {
      if (index === others.length - 1) next[item] = remaining * 5;
      else {
        const share = oldTotal ? Math.round((weights[item] || 0) / oldTotal * remaining) : Math.round(remaining / others.length);
        next[item] = share * 5; remaining -= share;
      }
    });
    setPreset('custom'); setWeights(next);
  }

  const selectedPaper = papers.find((paper) => paper.id === selectedId);
  const visiblePapers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...papers].filter((paper) => {
      const haystack = [paper.title, paper.abstract, paper.venue, paper.doi, ...(paper.authors || []), ...Object.values(paper.tags || {}).flat()].join(' ').toLowerCase();
      return (!q || haystack.includes(q)) && (!libraryFilters.status || paper.readingStatus === libraryFilters.status) && (!libraryFilters.modality.length || libraryFilters.modality.some((value) => paper.tags.modalities.includes(value))) && (!libraryFilters.task.length || libraryFilters.task.some((value) => paper.tags.tasks.includes(value))) && (!libraryFilters.year || String(paper.year) === libraryFilters.year) && (!onlySelectedTag || Object.values(paper.tags).flat().includes(onlySelectedTag));
    }).sort((a, b) => sortBy === 'year' ? (Number(b.year) || 0) - (Number(a.year) || 0) : sortBy === 'updated' ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : String(a.title).localeCompare(String(b.title)));
  }, [papers, query, libraryFilters, sortBy, onlySelectedTag]);
  const mapPapers = useMemo(() => papers.filter((paper) => (!mapTask || paper.tags.tasks.includes(mapTask)) && (!mapModality || paper.tags.modalities.includes(mapModality)) && (!mapYear || String(paper.year) === mapYear)), [papers, mapTask, mapModality, mapYear]);
  const edges = useMemo(() => computeEdges(mapPapers, weights, threshold / 100, maxEdges), [mapPapers, weights, threshold, maxEdges]);
  const computedEdges = edges.filter((edge) => edge.type === 'computed');
  const explicitEdges = edges.filter((edge) => edge.type === 'explicit');
  const awaiting = papers.filter((paper) => paper.verificationStatus !== 'Verified').length;
  const readingCount = papers.filter((paper) => paper.readingStatus === 'Completed').length;
  const unreadCount = papers.filter((paper) => paper.readingStatus === 'Unread').length;
  const readingPaper = papers.find((paper) => paper.id === readingId) || papers[0];
  const pdfUrl = useMemoPdfUrl(readingPaper?.pdfBlob);
  const activePresetLabel = PRESET_LABELS[preset] || savedPresets.find((item) => item.id === preset)?.name || '自定义视角';

  async function handlePdfFiles(files) {
    const selected = [...files].filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!selected.length) { flash('请选择 PDF 文件。'); return; }
    setImportBusy(true);
    const newItems = [];
    for (const file of selected) {
      const paper = emptyPaper(activeDomainId); paper.pdfBlob = file; paper.pdfName = file.name; paper.verificationStatus = 'Automatically Extracted';
      try {
        const candidate = await extractPdfCandidates(file);
        paper.title = candidate.title; paper.year = candidate.year; paper.doi = candidate.doi; paper.abstract = candidate.abstract;
        paper.extractionNote = `从前 ${Math.min(candidate.pages, 4)} 页提取候选信息，请校对。`;
      } catch {
        paper.title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
        paper.extractionNote = '未能读取 PDF 文本，请手动填写文献信息。';
      }
      newItems.push({ queueId: crypto.randomUUID(), paper });
    }
    setImportQueue((queue) => [...queue, ...newItems]); setImportBusy(false); if (importInput.current) importInput.current.value = ''; flash(`已读取 ${newItems.length} 个 PDF，候选信息待校对。`);
  }
  async function handleBibFile(file) {
    if (!file) return;
    const raw = await file.text(); const parsed = parseBibtex(raw, domainTaxonomy, activeDomainId); const input = document.querySelector('.import-card input[type="file"][accept*=".bib"]'); if (input) input.value = '';
    if (!parsed.length) { flash('未找到有效 BibTeX 记录，请检查文件格式。'); return; }
    setImportQueue((queue) => [...queue, ...parsed.map((paper) => ({ queueId: crypto.randomUUID(), paper }))]);
    flash(`已解析 ${parsed.length} 条 BibTeX 记录。`);
  }
  function isDuplicate(paper, queueId = '') {
    const queueIndex = queueId ? importQueue.findIndex((item) => item.queueId === queueId) : importQueue.length;
    return papers.find((item) => sameBibliographicPaper(item, paper)) || importQueue.slice(0, Math.max(queueIndex, 0)).find((item) => item.queueId !== queueId && sameBibliographicPaper(item.paper, paper))?.paper;
  }
  async function addQueueDirect(item, allowDuplicate = false) {
    const duplicate = isDuplicate(item.paper, item.queueId);
    if (duplicate && !allowDuplicate) { setConflict({ paper: item.paper, match: duplicate, queueId: item.queueId }); return; }
    const paper = normalizePaper(item.paper); await persistPaper(paper); setImportQueue((queue) => queue.filter((entry) => entry.queueId !== item.queueId));
    flash('已添加论文，元数据仍需校对。');
  }
  async function addAllQueue() {
    const toAdd = importQueue.filter((item) => !isDuplicate(item.paper, item.queueId));
    const dupes = importQueue.filter((item) => isDuplicate(item.paper, item.queueId));
    if (toAdd.length) { await persistAll([...toAdd.map((item) => normalizePaper(item.paper)), ...papers]); setImportQueue(dupes); }
    if (dupes.length) flash(`已添加 ${toAdd.length} 篇；另有 ${dupes.length} 篇疑似重复，请逐条处理。`);
    else flash(`已添加 ${toAdd.length} 篇论文。`);
  }
  async function exportBackup() {
    const withPdfs = await Promise.all(papers.map(async (paper) => {
      const copy = { ...paper };
      if (paper.pdfBlob instanceof Blob) copy.pdfBase64 = await blobToBase64(paper.pdfBlob);
      delete copy.pdfBlob;
      return copy;
    }));
    downloadFile(`phishmap-${activeDomain?.name || 'research'}-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schema: 'phishmap-backup', version: 2, exportedAt: new Date().toISOString(), domain: activeDomain, papers: withPdfs }, null, 2), 'application/json');
    flash('完整备份已导出到下载目录。');
  }
  async function restoreBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.papers)) throw new Error('备份中没有论文列表');
      const imported = data.papers.map((item) => {
        const paper = normalizePaper({ ...item, domainId: activeDomainId });
        if (item.pdfBase64) { const [meta, body] = item.pdfBase64.split(','); const mime = meta.match(/data:([^;]+)/)?.[1] || 'application/pdf'; paper.pdfBlob = base64ToBlob(body, mime); }
        delete paper.pdfBase64; return paper;
      });
      if (restoreMode === 'replace' && !window.confirm(`恢复 ${imported.length} 篇论文并替换当前 ${papers.length} 篇记录？建议先导出备份。`)) return;
      if (restoreMode === 'replace') { await replaceDomainPapers(activeDomainId, imported); setPapers(imported); }
      else await persistAll([...imported.filter((incoming) => !papers.some((existing) => existing.id === incoming.id)), ...papers]);
      flash(`已恢复 ${imported.length} 篇论文。`);
    } catch (error) { flash(`无法恢复备份：${error.message}`); }
    if (backupInput.current) backupInput.current.value = '';
  }
  async function exportComparison(format) {
    const chosen = papers.filter((paper) => compareIds.includes(paper.id));
    if (format === 'csv') {
      const rows = [['论文', ...MATRIX_FIELDS.map(([, label]) => label)]];
      chosen.forEach((paper) => rows.push([paper.title, ...MATRIX_FIELDS.map(([key]) => cellValue(paper, key))]));
      downloadFile('phishmap-comparison.csv', rows.map((row) => row.map(csvEscape).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    } else {
      const rows = ['| 对比维度 | ' + chosen.map((paper) => paper.title.replaceAll('|', '\\|')).join(' | ') + ' |', '| ' + ['---', ...chosen.map(() => '---')].join(' | ') + ' |'];
      MATRIX_FIELDS.forEach(([key, label]) => rows.push(`| ${label} | ${chosen.map((paper) => cellValue(paper, key).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`));
      downloadFile('phishmap-comparison.md', rows.join('\n'), 'text/markdown;charset=utf-8');
    }
    flash(`${format.toUpperCase()} 对比文件已导出。`);
  }
  function addNote() {
    if (!readingPaper || !noteDraft.trim()) return;
    persistPaper({ ...readingPaper, notes: [{ id: crypto.randomUUID(), type: noteType, content: noteDraft.trim(), page: notePage, createdAt: new Date().toISOString() }, ...readingPaper.notes] });
    setNoteDraft(''); setNotePage(''); flash('阅读笔记已保存。');
  }
  function addEvidence() {
    if (!readingPaper || !evidenceDraft.page) { flash('请填写证据页码。'); return; }
    persistPaper({ ...readingPaper, evidence: [{ id: crypto.randomUUID(), ...evidenceDraft, status: 'Manually Edited', createdAt: new Date().toISOString() }, ...readingPaper.evidence] });
    setEvidenceDraft({ field: 'problem', page: '', quote: '' }); flash('证据定位已保存。');
  }
  function addRelation() {
    if (!selectedPaper || !relationDraft.targetId || relationDraft.targetId === selectedPaper.id) return;
    const relation = { id: crypto.randomUUID(), targetId: relationDraft.targetId, type: relationDraft.type, explanation: relationDraft.explanation, source: '用户手动确认', status: 'Confirmed' };
    persistPaper({ ...selectedPaper, relations: [...selectedPaper.relations, relation] });
    setRelationDraft({ targetId: '', type: 'Similar Method', explanation: '' }); flash('人工关系已保存。');
  }
  function setReadingStatus(paper, value) { persistPaper({ ...paper, readingStatus: value }); }
  function setAnalysis(paper, key, value) { setPapers((old) => old.map((item) => item.id === paper.id ? { ...item, analysis: { ...item.analysis, [key]: value } } : item)); }
  async function persistAnalysis(paper) { await persistPaper(paper); }

  function renderOverview() {
    const modalityCounts = (domainTaxonomy.modalities || []).map((modality) => [modality, papers.filter((paper) => paper.tags.modalities.includes(modality)).length]).filter(([, count]) => count > 0);
    const methodCounts = [...new Set(papers.flatMap((paper) => paper.tags.fusionStages))].map((method) => [method, papers.filter((paper) => paper.tags.fusionStages.includes(method)).length]);
    return <>
      <section className="welcome-band">
        <div className="welcome-copy"><span className="welcome-mark"><Shield size={17} />研究资料库</span><h1>让论文之间的联系<br />变得清晰可见。</h1><p>从文献整理到方法比较，把每一条研究线索都留在自己的知识地图里。</p><div className="welcome-actions"><button className="button button-bright" onClick={() => setPage('import')}><Plus size={16} />添加论文</button><button className="button button-outline-light" onClick={() => setPage('map')}><MapIcon size={16} />打开研究地图</button></div></div>
        <div className="welcome-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><span className="orbit-node node-one">URL</span><span className="orbit-node node-two">HTML</span><span className="orbit-node node-three">视觉</span><span className="orbit-node node-four">融合</span><div className="orbit-center"><Network size={26} /><span>论文关系</span></div><div className="orbit-link link-one" /><div className="orbit-link link-two" /><div className="orbit-link link-three" /></div>
      </section>
      <div className="stat-strip">
        <div className="stat"><span className="stat-icon"><Library size={22} /></span><div className="stat-copy"><span>论文总数</span><strong>{papers.length}</strong><small>{papers.length ? '本地知识库' : '等待第一篇论文'}</small></div></div>
        <div className="stat"><span className="stat-icon"><Clock3 size={22} /></span><div className="stat-copy"><span>待校对</span><strong>{awaiting}</strong><small>{awaiting ? '元数据尚未确认' : '记录均已核对'}</small></div></div>
        <div className="stat"><span className="stat-icon"><BookOpen size={22} /></span><div className="stat-copy"><span>完成阅读</span><strong>{readingCount}<em> / {papers.length}</em></strong><small>{papers.length ? `${Math.round(readingCount / papers.length * 100)}% 阅读进度` : '记录阅读进度'}</small></div></div>
        <div className="stat"><span className="stat-icon"><GitBranch size={22} /></span><div className="stat-copy"><span>已确认关系</span><strong>{papers.reduce((sum, paper) => sum + paper.relations.filter((relation) => relation.status === 'Confirmed').length, 0)}</strong><small>人工记录的研究联系</small></div></div>
      </div>
      <div className="section-heading"><div><h2>研究资料概览</h2><p>统计会按论文记录计算，多模态论文可同时计入多个类别。</p></div><button className="text-button" onClick={() => setPage('library')}>浏览论文库 <ArrowRight size={15} /></button></div>
      {!papers.length ? <div className="overview-empty"><EmptyState icon={Archive} title="你的研究地图还没有论文" body="导入 PDF 或 BibTeX，或者手动创建第一条记录。论文和附件会保存在此浏览器的本地数据库中。" action="导入第一篇论文" onAction={() => setPage('import')} /></div> : <div className="overview-grid">
        <section className="panel distribution-panel"><div className="panel-heading"><div><h3>输入模态</h3><p>按已记录标签统计</p></div><span className="panel-icon"><Layers3 size={17} /></span></div>{modalityCounts.length ? <div className="distribution-list">{modalityCounts.map(([name, count]) => <div className="distribution-row" key={name}><span className={`modality-dot dot-${name.toLowerCase()}`} /><span>{name}</span><div className="bar-track"><div style={{ width: `${Math.max(5, count / Math.max(1, papers.length) * 100)}%` }} /></div><b>{count}</b></div>)}</div> : <p className="muted-note">确认论文的输入模态后，分布会显示在这里。</p>}</section>
        <section className="panel reading-panel"><div className="panel-heading"><div><h3>阅读进度</h3><p>Unread → Skimming → Reading → Completed</p></div><span className="panel-icon"><BookOpen size={17} /></span></div><div className="reading-progress"><div className="progress-donut" style={{ '--progress': `${papers.length ? readingCount / papers.length * 100 : 0}%` }}><strong>{papers.length ? Math.round(readingCount / papers.length * 100) : 0}<small>%</small></strong></div><div className="reading-breakdown">{READING_STATES.map((state) => <div key={state}><span>{state}</span><b>{papers.filter((paper) => paper.readingStatus === state).length}</b></div>)}</div></div><button className="subtle-link" onClick={() => setPage('reading')}>继续阅读 <ArrowRight size={14} /></button></section>
        <section className="panel recent-panel"><div className="panel-heading"><div><h3>最近更新</h3><p>最近编辑的论文记录</p></div><Clock3 size={17} className="muted-icon" /></div>{[...papers].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 4).map((paper) => <button key={paper.id} className="recent-row" onClick={() => { setSelectedId(paper.id); setPage('library'); }}><span className="paper-mark"><FileText size={15} /></span><span className="recent-title"><b>{paper.title || '未命名论文'}</b><small>{paper.year || '年份未知'} · {paper.venue || '来源待补充'}</small></span><ArrowRight size={14} /></button>)}</section>
        <section className="panel workflow-panel"><div className="panel-heading"><div><h3>待处理事项</h3><p>完善资料后，地图与比较会更准确</p></div><CircleHelp size={17} className="muted-icon" /></div><button className="task-row" onClick={() => setPage('library')}><span className="task-indicator" /><span><b>元数据待核对</b><small>自动提取字段需要人工确认</small></span><strong>{awaiting}</strong></button><button className="task-row" onClick={() => setPage('reading')}><span className="task-indicator task-blue" /><span><b>尚未开始阅读</b><small>从摘要浏览或精读开始记录</small></span><strong>{unreadCount}</strong></button><button className="task-row" onClick={() => setPage('map')}><span className="task-indicator task-green" /><span><b>地图关系计算</b><small>关系分数依赖已确认分类</small></span><ArrowRight size={15} /></button></section>
      </div>}
    </>;
  }

  function renderLibrary() {
    return <><div className="page-heading"><div><span className="breadcrumb">研究资料库 / 文献管理</span><h1>论文库</h1><p>用多维标签整理研究问题、输入模态与方法结构。</p></div><button className="button button-dark" onClick={() => openEditor()}><Plus size={16} />手动添加</button></div>
      <div className="filter-row"><label className="input-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、摘要、DOI…" /></label><select value={libraryFilters.status} onChange={(event) => setLibraryFilters({ ...libraryFilters, status: event.target.value })}><option value="">全部阅读状态</option>{READING_STATES.map((state) => <option key={state}>{state}</option>)}</select><MultiSelectFilter title="输入模态" values={libraryFilters.modality} options={domainTaxonomy.modalities || []} onChange={(value) => setLibraryFilters({ ...libraryFilters, modality: value })} /><MultiSelectFilter title="研究任务" values={libraryFilters.task} options={domainTaxonomy.tasks || []} onChange={(value) => setLibraryFilters({ ...libraryFilters, task: value })} /><select value={libraryFilters.year} onChange={(event) => setLibraryFilters({ ...libraryFilters, year: event.target.value })}><option value="">全部年份</option>{[...new Set(papers.map((paper) => paper.year).filter(Boolean))].sort().reverse().map((year) => <option key={year}>{year}</option>)}</select><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="title">按标题排序</option><option value="year">按年份排序</option><option value="updated">按最近更新</option></select></div>
      {onlySelectedTag && <button className="filter-chip" onClick={() => setOnlySelectedTag('')}>标签：{onlySelectedTag}<X size={13} /></button>}
      <div className="library-layout"><section className="panel library-table-panel"><div className="table-toolbar"><span><b>{visiblePapers.length}</b> 条记录</span><span className="hint"><Filter size={14} />不同筛选维度之间为 AND；同一维度内为 OR</span></div>{!visiblePapers.length ? <EmptyState icon={Library} title={papers.length ? '没有匹配的论文' : '论文库为空'} body={papers.length ? '调整筛选条件或清除搜索词。' : '导入一份 BibTeX、添加 PDF，或者创建一条空记录。'} action={papers.length ? '清除筛选' : '前往导入'} onAction={() => papers.length ? (setQuery(''), setLibraryFilters({ status: '', modality: [], task: [], year: '' }), setOnlySelectedTag('')) : setPage('import')} /> : <div className="table-scroll"><table className="paper-table"><thead><tr><th>论文</th><th>年份 / 来源</th><th>研究标签</th><th>阅读状态</th><th>校对</th><th /></tr></thead><tbody>{visiblePapers.map((paper) => <tr key={paper.id} className={selectedId === paper.id ? 'selected-row' : ''} onClick={() => setSelectedId(paper.id)}><td><button className="title-cell" onClick={(event) => { event.stopPropagation(); setSelectedId(paper.id); }}><b>{paper.title || '未命名论文'}</b><small>{(paper.authors || []).slice(0, 3).join(', ') || '作者待补充'}{paper.authors?.length > 3 ? ' et al.' : ''}</small></button></td><td><span className="year-cell">{paper.year || '—'}</span><small className="venue-cell">{paper.venue || '来源待补'}</small></td><td><div className="tag-stack">{paper.tags.modalities.slice(0, 2).map((tag) => <Badge key={tag} tone="blue">{tag}</Badge>)}{paper.tags.tasks.slice(0, 1).map((tag) => <Badge key={tag} tone="teal">{tag}</Badge>)}{paper.tags.modalities.length + paper.tags.tasks.length > 3 && <span className="tag-more">+{paper.tags.modalities.length + paper.tags.tasks.length - 3}</span>}</div></td><td><select className="inline-select" value={paper.readingStatus} onClick={(event) => event.stopPropagation()} onChange={(event) => setReadingStatus(paper, event.target.value)}>{READING_STATES.map((state) => <option key={state}>{state}</option>)}</select></td><td><Badge tone={paper.verificationStatus === 'Verified' ? 'green' : paper.verificationStatus === 'Missing' ? 'neutral' : 'amber'}>{paper.verificationStatus === 'Verified' ? '已确认' : paper.verificationStatus === 'Missing' ? '待补充' : '待校对'}</Badge></td><td><button className="icon-button tiny" aria-label="编辑论文" onClick={(event) => { event.stopPropagation(); openEditor(paper); }}><ChevronDown size={15} /></button></td></tr>)}</tbody></table></div>}</section>
        {selectedPaper && <aside className="panel detail-peek"><div className="peek-top"><span className="panel-kicker">论文预览</span><button className="icon-button" onClick={() => setSelectedId('')} aria-label="关闭预览"><X size={16} /></button></div><h2>{selectedPaper.title}</h2><p className="peek-authors">{selectedPaper.authors.join(', ') || '作者尚未记录'}{selectedPaper.year ? ` · ${selectedPaper.year}` : ''}</p><div className="peek-tags">{selectedPaper.tags.modalities.map((tag) => <Badge key={tag} tone="blue">{tag}</Badge>)}{selectedPaper.tags.tasks.map((tag) => <Badge key={tag} tone="teal">{tag}</Badge>)}</div><p className="peek-abstract">{selectedPaper.abstract || '尚未记录摘要。完善摘要后，可参与基础文本相似度计算。'}</p><div className="peek-actions"><button className="button button-dark" onClick={() => { setReadingId(selectedPaper.id); setPage('reading'); }}><BookOpen size={15} />打开阅读区</button><button className="button button-light" onClick={() => openEditor(selectedPaper)}>编辑记录</button></div><div className="peek-section"><h4>研究卡片</h4><p>{selectedPaper.analysis.problem || '尚未填写研究问题。'}</p></div><div className="peek-section"><h4>来源文件</h4>{selectedPaper.pdfBlob ? <button className="source-link" onClick={() => { setReadingId(selectedPaper.id); setPage('reading'); }}><FileText size={15} />{selectedPaper.pdfName || '已关联 PDF'}<ArrowRight size={14} /></button> : <span className="muted-note">未关联 PDF</span>}</div><button className="delete-link" onClick={() => deleteSelected(selectedPaper)}><Trash2 size={14} />删除论文记录</button></aside>}
      </div>
    </>;
  }

  function renderMap() {
    const [width, height] = [900, 610];
    const positions = mapPapers.map((paper, index) => {
      const seed = [...paper.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const angle = index * 2.399963 + (seed % 17) / 15; const radius = 55 + Math.sqrt(index + 1) * 53;
      return { x: width / 2 + Math.cos(angle) * Math.min(radius, 330), y: height / 2 + Math.sin(angle) * Math.min(radius * .66, 225), paper };
    });
    const posById = new Map(positions.map((item) => [item.paper.id, item]));
    const palette = ['#65a6c7', '#50b7a4', '#d89b58', '#897bd1', '#dc7796', '#80a75c', '#d36d5b', '#4a91a8', '#b2749a'];
    const colorFor = (value) => value ? palette[[...value].reduce((sum, char) => sum + char.codePointAt(0), 0) % palette.length] : '#96a3aa';
    const nodeColor = (paper) => mapColor === 'year' ? (Number(paper.year) >= 2022 ? '#51aa9b' : Number(paper.year) >= 2018 ? '#6ba7c4' : '#d49a5e') : mapColor === 'status' ? ({ Unread: '#9ba7ad', Skimming: '#d1a25f', Reading: '#6aa7c3', Completed: '#51aa9b' }[paper.readingStatus]) : colorFor(paper.tags[mapColor]?.[0]);
    const colorLegend = mapColor === 'year' ? [['2017 及以前', '#d49a5e'], ['2018–2021', '#6ba7c4'], ['2022 及以后', '#51aa9b'], ['年份未知', '#96a3aa']] : mapColor === 'status' ? [...new Set(mapPapers.map((paper) => paper.readingStatus))].map((label) => [label, ({ Unread: '#9ba7ad', Skimming: '#d1a25f', Reading: '#6aa7c3', Completed: '#51aa9b' }[label])]) : [...new Set(mapPapers.map((paper) => paper.tags[mapColor]?.[0] || '未分类'))].map((label) => [label, colorFor(label === '未分类' ? '' : label)]);
    const zoomMap = (delta) => setMapViewport((view) => ({ ...view, scale: Math.max(.55, Math.min(2.5, view.scale + delta)) }));
    const startMapDrag = (event) => { if (event.target.closest('.graph-node, .graph-edge')) return; mapDrag.current = { x: event.clientX, y: event.clientY, ox: mapViewport.x, oy: mapViewport.y }; event.currentTarget.setPointerCapture?.(event.pointerId); };
    const moveMapDrag = (event) => { const drag = mapDrag.current; if (!drag) return; const box = event.currentTarget.getBoundingClientRect(); setMapViewport((view) => ({ ...view, x: drag.ox + (event.clientX - drag.x) * width / box.width, y: drag.oy + (event.clientY - drag.y) * height / box.height })); };
    return <><div className="page-heading map-heading"><div><span className="breadcrumb">研究资料库 / 关系探索</span><h1>研究地图</h1><p>节点是论文；虚线表示计算相似，实线表示人工确认的研究关系。</p></div><button className="button button-light" onClick={() => setPage('library')}><Library size={15} />论文列表</button></div>
      {!papers.length ? <div className="map-empty"><EmptyState icon={Network} title="等待论文进入地图" body="导入论文并确认分类后，系统会根据可用维度计算相似度。关系线会附带分数、覆盖度和具体原因。" action="导入论文" onAction={() => setPage('import')} /></div> : <div className="map-workspace"><section className="panel map-panel"><div className="map-toolbar"><div className="map-count"><span className="live-dot" />{mapPapers.length} 篇论文 <span className="map-divider" />{computedEdges.length} 条相似关系</div><div className="map-toolbar-right"><label>节点着色<select value={mapColor} onChange={(event) => setMapColor(event.target.value)}>{tagGroups.filter(([key]) => !['datasets', 'evaluationSettings'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="year">发表年份</option><option value="status">阅读状态</option></select></label><button className="icon-button" title="缩小地图" onClick={() => zoomMap(-.15)}><Minus size={14} /></button><button className="icon-button" title="放大地图" onClick={() => zoomMap(.15)}><Plus size={14} /></button><button className="icon-button" title="重置地图视图" onClick={() => setMapViewport({ scale: 1, x: 0, y: 0 })}><Focus size={15} /></button></div></div>
          <div className="map-canvas"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="论文相似度关系图" preserveAspectRatio="xMidYMid meet" onWheel={(event) => { event.preventDefault(); zoomMap(event.deltaY < 0 ? .08 : -.08); }} onPointerDown={startMapDrag} onPointerMove={moveMapDrag} onPointerUp={() => { mapDrag.current = null; }} onPointerCancel={() => { mapDrag.current = null; }}><defs><pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dce4e7" /></pattern><filter id="nodeShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#42606d" floodOpacity=".14" /></filter></defs><rect width={width} height={height} fill="url(#dotGrid)" /><g transform={`translate(${mapViewport.x} ${mapViewport.y}) translate(${width / 2} ${height / 2}) scale(${mapViewport.scale}) translate(${-width / 2} ${-height / 2})`}>
            {edges.filter((edge) => mapRelation === 'both' || (mapRelation === 'computed' && edge.type === 'computed') || (mapRelation === 'explicit' && edge.type === 'explicit')).map((edge, index) => { const a = posById.get(edge.source); const b = posById.get(edge.target); return a && b ? <g key={`${edge.source}-${edge.target}-${edge.type}-${index}`} className="graph-edge" onClick={() => setGraphEdge(edge)}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={edge.type === 'explicit' ? 'edge-explicit' : 'edge-computed'} style={{ strokeWidth: edge.type === 'explicit' ? 2 : 1 + (edge.score || 0) * 2 }} /><title>{edge.type === 'explicit' ? `${edge.relationType}（人工确认）` : `计算相似度 ${Math.round(edge.score * 100)}% · 覆盖 ${Math.round(edge.coverage * 100)}%`}</title></g> : null; })}
            {positions.map(({ paper, x, y }) => <g key={paper.id} role="button" tabIndex="0" aria-label={`打开论文：${paper.title}`} className={`graph-node ${selectedId === paper.id ? 'graph-node-selected' : ''}`} transform={`translate(${x} ${y})`} onClick={() => setSelectedId(paper.id)} onDoubleClick={() => { setReadingId(paper.id); setPage('reading'); }} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(paper.id); }}><circle r={selectedId === paper.id ? 12 : 9} fill={nodeColor(paper)} filter="url(#nodeShadow)" /><circle r="15" className="node-halo" /><text y="27" textAnchor="middle">{paper.title.length > 25 ? `${paper.title.slice(0, 24)}…` : paper.title}</text></g>)}</g></svg>{!mapPapers.length && <div className="map-filter-empty">当前筛选没有匹配论文。<button onClick={() => { setMapTask(''); setMapModality(''); setMapYear(''); }}>清除筛选</button></div>}</div>
          <div className="map-legend"><span className="legend-title">节点颜色</span>{colorLegend.map(([label, color]) => <span key={label}><i className="legend-dot" style={{ background: color }} />{label}</span>)}<span><i className="legend-line dashed" />计算相似关系</span><span><i className="legend-line solid" />人工确认关系</span><span className="legend-note">布局距离仅用于视觉呈现，关系强度以分数为准。</span></div></section>
          <aside className="map-side"><section className="panel map-filter-panel"><div className="side-heading"><div><h3>地图筛选</h3><p>选择后即时更新</p></div><SlidersHorizontal size={16} /></div><label className="field-label">研究任务<select value={mapTask} onChange={(event) => setMapTask(event.target.value)}><option value="">所有任务</option>{(domainTaxonomy.tasks || []).map((task) => <option key={task}>{task}</option>)}</select></label><label className="field-label">输入模态<select value={mapModality} onChange={(event) => setMapModality(event.target.value)}><option value="">所有模态</option>{(domainTaxonomy.modalities || []).map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">发表年份<select value={mapYear} onChange={(event) => setMapYear(event.target.value)}><option value="">所有年份</option>{[...new Set(papers.map((paper) => paper.year).filter(Boolean))].sort().reverse().map((year) => <option key={year}>{year}</option>)}</select></label><label className="field-label">显示关系<select value={mapRelation} onChange={(event) => setMapRelation(event.target.value)}><option value="both">全部关系</option><option value="computed">计算相似</option><option value="explicit">人工确认</option></select></label><div className="field-label">最低相似度 <b className="range-value">{threshold}%</b><input className="range-input" type="range" min="20" max="90" step="5" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></div><div className="field-label">每篇论文最多关系数 <b className="range-value">{maxEdges}</b><input className="range-input" type="range" min="1" max="6" value={maxEdges} onChange={(event) => setMaxEdges(Number(event.target.value))} /></div></section>
            <section className="panel weight-panel"><div className="side-heading"><div><h3>相似度权重</h3><p>仅确认标签参与分类维度</p></div><Sparkles size={16} /></div><div className="preset-switch">{Object.entries(PRESET_LABELS).map(([key, label]) => <button key={key} className={preset === key ? 'active' : ''} onClick={() => changePreset(key)}>{label}</button>)}{savedPresets.map((item) => <button key={item.id} className={preset === item.id ? 'active' : ''} onClick={() => applySavedPreset(item)}>{item.name}</button>)}</div>{DIMENSIONS.map(([key, label]) => <label className="weight-row" key={key}><span>{label}</span><input type="range" min="0" max="50" step="5" value={weights[key]} onChange={(event) => changeWeight(key, Number(event.target.value))} /><b>{weights[key]}%</b></label>)}<div className="weight-foot"><span>当前总权重</span><b>{Object.values(weights).reduce((sum, weight) => sum + Number(weight), 0)}%</b><button className="text-button small" onClick={saveWeightPreset}>保存预设</button><button className="text-button small" onClick={() => changePreset('balanced')}>恢复默认</button></div></section>
            {selectedPaper && <section className="panel selected-node-panel"><div className="side-heading"><h3>当前论文</h3><button className="text-button small" onClick={() => { setPage('library'); }}>详情</button></div><b className="selected-node-title">{selectedPaper.title}</b><p>{selectedPaper.year || '年份未知'} · {selectedPaper.venue || '来源未记录'}</p><div className="peek-tags">{selectedPaper.tags.modalities.map((tag) => <Badge key={tag} tone="blue">{tag}</Badge>)}</div><button className="button button-light button-full" onClick={() => setCompareIds((ids) => ids.includes(selectedPaper.id) ? ids : [...ids, selectedPaper.id])}><Plus size={14} />加入对比</button><details className="relation-adder"><summary><Link2 size={14} />添加人工关系</summary><select value={relationDraft.targetId} onChange={(event) => setRelationDraft({ ...relationDraft, targetId: event.target.value })}><option value="">选择另一篇论文</option>{papers.filter((paper) => paper.id !== selectedPaper.id).map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}</select><select value={relationDraft.type} onChange={(event) => setRelationDraft({ ...relationDraft, type: event.target.value })}>{RELATION_TYPES.map((type) => <option key={type}>{type}</option>)}</select><textarea rows="2" value={relationDraft.explanation} onChange={(event) => setRelationDraft({ ...relationDraft, explanation: event.target.value })} placeholder="关系说明或来源（可选）" /><button className="button button-dark button-full" disabled={!relationDraft.targetId} onClick={addRelation}><Plus size={14} />确认关系</button></details></section>}
            {activeEdge && <EdgeDetails edge={activeEdge} papers={papers} onClose={() => setActiveEdge(null)} />}
          </aside>
        </div>}
    </>;
  }

  // Edge selection is kept separately from paper selection so computed similarity never appears as a citation.
  function setGraphEdge(edge) { setActiveEdge(edge); }
  function renderCompare() {
    const chosen = papers.filter((paper) => compareIds.includes(paper.id));
    return <><div className="page-heading"><div><span className="breadcrumb">研究资料库 / 方法分析</span><h1>论文对比</h1><p>并排检查研究任务、输入模态、方法结构与实验上下文。</p></div><div className="heading-actions"><button className="button button-light" disabled={chosen.length < 2} onClick={() => exportComparison('md')}><FileDown size={15} />导出 Markdown</button><button className="button button-light" disabled={chosen.length < 2} onClick={() => exportComparison('csv')}>导出 CSV</button></div></div>
      <section className="panel compare-picker"><div className="picker-title"><div><h3>选择论文</h3><p>选择 2–4 篇；缺失信息会显示为“未记录”。</p></div><Badge tone={chosen.length >= 2 ? 'green' : 'neutral'}>{chosen.length} / 4 已选</Badge></div><div className="picker-list">{papers.map((paper) => <label key={paper.id} className={`picker-item ${compareIds.includes(paper.id) ? 'picker-selected' : ''}`}><input type="checkbox" checked={compareIds.includes(paper.id)} disabled={!compareIds.includes(paper.id) && chosen.length >= 4} onChange={() => setCompareIds((ids) => ids.includes(paper.id) ? ids.filter((id) => id !== paper.id) : [...ids, paper.id])} /><span className="picker-mark"><FileText size={15} /></span><span className="picker-copy"><b>{paper.title || '未命名论文'}</b><small>{paper.year || '年份未知'} · {paper.venue || '来源未记录'}</small></span><span className="picker-state">{paper.readingStatus}</span></label>)}</div></section>
      {chosen.length >= 2 ? <section className="panel matrix-panel"><div className="matrix-top"><div><h3>方法与实验矩阵</h3><p>实验指标保留数据集和评估设置上下文，不据此自动判断整体优劣。高亮行表示记录存在差异。</p></div><button className="text-button" onClick={() => setCompareIds([])}>清空选择</button></div><div className="table-scroll"><table className="matrix-table"><thead><tr><th>对比维度</th>{chosen.map((paper) => <th key={paper.id}><span>{paper.year || '年份未知'}</span><b>{paper.title}</b><small>{paper.venue || '来源未记录'}</small></th>)}</tr></thead><tbody>{MATRIX_FIELDS.map(([key, label]) => { const values = chosen.map((paper) => cellValue(paper, key)).filter(Boolean); const different = new Set(values).size > 1; return <tr className={different ? 'matrix-different' : ''} key={key}><th>{label}</th>{chosen.map((paper) => <td key={paper.id}>{cellValue(paper, key) || <span className="unreported">未记录</span>}</td>)}</tr>; })}</tbody></table></div></section> : <div className="compare-empty"><GitBranch size={23} /><b>从两篇论文开始对比</b><span>可从地图中加入论文，或在上方勾选。</span></div>}
    </>;
  }

  function renderReading() {
    return <><div className="page-heading reading-heading"><div><span className="breadcrumb">研究资料库 / 精读记录</span><h1>阅读工作区</h1><p>让原文、研究卡片和页码证据在同一处并排。</p></div>{readingPaper && <select className="reading-paper-select" value={readingPaper.id} onChange={(event) => setReadingId(event.target.value)}>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title || '未命名论文'}</option>)}</select>}</div>
      {!readingPaper ? <div className="reading-empty"><EmptyState icon={BookOpen} title="还没有可阅读的论文" body="导入 PDF 或先创建论文记录，然后回来填写研究卡片和阅读笔记。" action="添加论文" onAction={() => setPage('import')} /></div> : <div className="reading-workspace"><section className="panel pdf-pane"><div className="pane-header"><div><span className="panel-kicker">原文</span><b>{readingPaper.pdfName || '尚未关联 PDF'}</b></div>{readingPaper.pdfBlob && <a className="icon-button" href={pdfUrl} download={readingPaper.pdfName || 'paper.pdf'} title="下载原始 PDF"><ArrowDownToLine size={15} /></a>}</div>{readingPaper.pdfBlob ? <iframe src={pdfUrl} title={`${readingPaper.title} PDF 原文`} /> : <div className="pdf-placeholder"><FileText size={27} /><b>尚未关联 PDF 文件</b><span>可以先使用右侧研究卡片记录已知信息。</span><button className="button button-light" onClick={() => { setPage('import'); }}>前往导入 PDF</button></div>}</section>
        <section className="panel reading-notes-pane"><div className="reading-paper-title"><span className="panel-kicker">当前论文</span><h2>{readingPaper.title}</h2><p>{readingPaper.authors.join(', ') || '作者未记录'}{readingPaper.year ? ` · ${readingPaper.year}` : ''}{readingPaper.venue ? ` · ${readingPaper.venue}` : ''}</p><div className="reading-meta-controls"><label>阅读进度<select value={readingPaper.readingStatus} onChange={(event) => setReadingStatus(readingPaper, event.target.value)}>{READING_STATES.map((state) => <option key={state}>{state}</option>)}</select></label><label className="checkline"><input type="checkbox" checked={readingPaper.reproduced} onChange={(event) => persistPaper({ ...readingPaper, reproduced: event.target.checked })} />已尝试复现</label></div></div>
          <div className="research-card"><div className="section-heading compact"><div><h3>研究卡片</h3><p>仅记录论文原文或你的判断，不必强行补全。</p></div><button className="text-button small" onClick={() => openEditor(readingPaper)}>编辑分类</button></div>{ANALYSIS_FIELDS.map(([key, label]) => <label className="analysis-field" key={key}><span>{label}</span><textarea value={readingPaper.analysis[key] || ''} placeholder="未记录" rows={key === 'problem' || key === 'contributions' || key === 'limitations' ? 2 : 1} onChange={(event) => setAnalysis(readingPaper, key, event.target.value)} onBlur={() => persistAnalysis({ ...readingPaper, analysis: { ...readingPaper.analysis, [key]: readingPaper.analysis[key] || '' } })} /></label>)}
            <div className="evidence-box"><div className="subsection-heading"><h4>证据定位</h4><span>页码 + 可选摘录</span></div><div className="evidence-form"><select value={evidenceDraft.field} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, field: event.target.value })}>{ANALYSIS_FIELDS.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><input type="number" min="1" placeholder="页码" value={evidenceDraft.page} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, page: event.target.value })} /><input placeholder="可选的原文摘录" value={evidenceDraft.quote} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, quote: event.target.value })} /><button className="icon-button" onClick={addEvidence} title="添加证据"><Plus size={15} /></button></div>{readingPaper.evidence.length ? readingPaper.evidence.map((evidence) => <div className="evidence-row" key={evidence.id}><span>p. {evidence.page}</span><b>{ANALYSIS_FIELDS.find(([key]) => key === evidence.field)?.[1] || evidence.field}</b><small>{evidence.quote || '未添加摘录'}</small><button className="icon-button tiny" onClick={() => persistPaper({ ...readingPaper, evidence: readingPaper.evidence.filter((item) => item.id !== evidence.id) })}><X size={13} /></button></div>) : <p className="muted-note">还没有保存的证据定位。</p>}</div>
          </div>
          <div className="note-composer"><div className="subsection-heading"><h4>阅读笔记</h4><span>{readingPaper.notes.length} 条记录</span></div><div className="note-input-row"><select value={noteType} onChange={(event) => setNoteType(event.target.value)}><option>摘要</option><option>方法理解</option><option>疑问</option><option>创新点判断</option><option>实验观察</option><option>研究灵感</option></select><input type="number" min="1" placeholder="页码" value={notePage} onChange={(event) => setNotePage(event.target.value)} /><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="写下方法理解、疑问或实验观察…" rows="2" /><button className="button button-dark" onClick={addNote}><Plus size={14} />保存笔记</button></div>{readingPaper.notes.map((note) => <article className="note-card" key={note.id}><div><Badge tone="blue">{note.type || '阅读观察'}</Badge>{note.page && <span className="note-page">p. {note.page}</span>}<time>{fmtDate(note.createdAt)}</time><button className="icon-button tiny" onClick={() => persistPaper({ ...readingPaper, notes: readingPaper.notes.filter((item) => item.id !== note.id) })}><Trash2 size={13} /></button></div><p>{note.content}</p></article>)}</div>
        </section></div>}
    </>;
  }

  function renderImport() {
    return <><div className="page-heading"><div><span className="breadcrumb">研究资料库 / 新增文献</span><h1>导入中心</h1><p>文件会留在本地；自动提取的字段将以候选信息进入待校对队列。</p></div></div>
      <div className="import-grid"><section className="panel import-card primary-import"><div className="import-icon"><Upload size={20} /></div><h3>导入 PDF</h3><p>支持批量添加。系统会读取前几页文字，尝试提取标题、年份、DOI 和摘要。</p><input ref={importInput} type="file" accept=".pdf,application/pdf" multiple onChange={(event) => handlePdfFiles(event.target.files)} hidden /><button className="button button-dark" disabled={importBusy} onClick={() => importInput.current?.click()}>{importBusy ? <Activity className="spin" size={15} /> : <Plus size={15} />}{importBusy ? '正在读取…' : '选择 PDF 文件'}</button><small className="privacy-note"><LockKeyhole size={13} />PDF 文件本身不会上传；AI 会按需处理文字片段</small></section>
        <section className="panel import-card"><div className="import-icon import-icon-blue"><FileText size={20} /></div><h3>导入 BibTeX</h3><p>解析 .bib 记录并保留原始条目。 DOI 和标题将用于提示可能的重复论文。</p><label className="button button-light file-button"><Plus size={15} />选择 .bib 文件<input type="file" accept=".bib,text/plain" onChange={(event) => handleBibFile(event.target.files?.[0])} hidden /></label><small className="privacy-note"><Check size={13} />导入前可检查、编辑或跳过记录</small></section>
        <section className="panel import-card"><div className="import-icon import-icon-green"><Plus size={20} /></div><h3>手动创建</h3><p>没有 PDF 或 BibTeX 时，可以先创建空记录，之后再完善元数据、标签和研究卡片。</p><button className="button button-light" onClick={() => openEditor()}><Plus size={15} />新建论文记录</button><small className="privacy-note"><CircleHelp size={13} />标题可先留空，保存时需要填写</small></section></div>
      <div className="section-heading import-queue-heading"><div><h2>待校对队列</h2><p>{importQueue.length ? `${importQueue.length} 条导入记录尚未保存` : '新导入的论文会显示在这里'}</p></div>{importQueue.length > 0 && <button className="button button-light" onClick={addAllQueue}><CheckCheck size={15} />批量添加无重复项</button>}</div>
      {importQueue.length ? <section className="panel import-queue">{importQueue.map((item) => { const duplicate = isDuplicate(item.paper, item.queueId); return <div className="queue-row" key={item.queueId}><span className="queue-file"><FileText size={16} /></span><div className="queue-copy"><b>{item.paper.title || '未识别标题'}</b><span>{item.paper.authors?.slice(0, 2).join(', ') || '作者待补'}{item.paper.year ? ` · ${item.paper.year}` : ''}{item.paper.venue ? ` · ${item.paper.venue}` : ''}</span><small>{item.paper.extractionNote || item.paper.doi || item.paper.pdfName || (item.paper.bibtexKey ? `BibTeX key: ${item.paper.bibtexKey}` : '自动提取结果待人工校对')}</small>{duplicate && <em>疑似与“{duplicate.title}”重复</em>}</div><div className="queue-actions"><button className="button button-light" onClick={() => assistQueuedPaper(item)} disabled={!aiStatus.configured || aiQueueBusyId === item.queueId}>{aiQueueBusyId === item.queueId ? <Activity className="spin" size={14} /> : <Sparkles size={14} />}AI 补全</button><button className="button button-light" onClick={() => openEditor(item.paper, item.queueId)}>校对并添加</button><button className="button button-dark" onClick={() => addQueueDirect(item, false)} disabled={!!duplicate}>直接添加</button><button className="icon-button" title="跳过此记录" onClick={() => setImportQueue((queue) => queue.filter((entry) => entry.queueId !== item.queueId))}><X size={15} /></button></div></div>; })}</section> : <section className="panel queue-empty"><FilePlus2 size={19} /><span>队列为空。导入的文件会先进入待校对流程，不会静默覆盖已有记录。</span></section>}
      <section className="import-guide"><div className="guide-step"><span>文件进入本地</span><b>PDF / BibTeX</b></div><ArrowRight size={15} /><div className="guide-step"><span>检查自动候选</span><b>标题 · 作者 · DOI</b></div><ArrowRight size={15} /><div className="guide-step"><span>人工核对与分类</span><b>标签 · 阅读卡片</b></div><ArrowRight size={15} /><div className="guide-step"><span>加入研究地图</span><b>计算可解释关联</b></div></section>
    </>;
  }

  function renderTaxonomy() {
    return <><div className="page-heading"><div><span className="breadcrumb">{activeDomain?.name || '研究领域'} / 数据规范</span><h1>分类体系</h1><p>此分类标准仅用于当前领域；修改标签不会影响其他研究领域。</p></div><Badge tone="blue">{tagGroups.length} 个分类维度</Badge></div><div className="taxonomy-grid">{tagGroups.map(([key, title, terms, dimension]) => <section className="panel taxonomy-card" key={key}><div className="taxonomy-heading"><span className="taxonomy-symbol"><Tag size={16} /></span><div><h3>{title}</h3><small>{terms.length} 个标准标签{dimension ? ` · ${dimension === 'method' ? '方法相似度' : dimension === 'experiments' ? '实验相似度' : '分类相似度'}` : ''}</small></div></div><p>{TAXONOMY_DESCRIPTIONS[key]}</p><div className="taxonomy-tags">{terms.map((term) => <span className="taxonomy-tag-item" key={term}><button type="button" className="taxonomy-tag-value" onClick={() => { setOnlySelectedTag(term); setPage('library'); }} title={`查看包含“${term}”的论文`}>{term}<small>{papers.filter((paper) => Object.values(paper.tags).flat().includes(term)).length}</small></button><button type="button" className="taxonomy-tag-remove" aria-label={`从${title}移除${term}`} onClick={() => saveDomainTaxonomy(key, terms.filter((value) => value !== term))}><X size={11} /></button></span>)}</div><form className="taxonomy-add-form" onSubmit={async (event) => { event.preventDefault(); const value = (taxonomyDrafts[key] || '').trim(); if (!value) return; if (terms.includes(value)) { flash('该标签已经存在。'); return; } await saveDomainTaxonomy(key, [...terms, value]); setTaxonomyDrafts((old) => ({ ...old, [key]: '' })); }}><input value={taxonomyDrafts[key] || ''} onChange={(event) => setTaxonomyDrafts((old) => ({ ...old, [key]: event.target.value }))} placeholder={`为「${title}」添加标准标签`} aria-label={`为${title}添加标签`} /><button type="submit" className="button button-light" title="添加标签"><Plus size={14} />添加</button></form></section>)}</div><section className="panel taxonomy-note"><Shield size={18} /><div><b>分类可信度</b><p>AI 只会从当前领域的标准标签中提出候选。候选标签不会自动成为已确认信息；只有人工确认后，相关分类才参与研究地图的相似度计算。删除标准标签不会删除已保存的论文记录。</p></div></section></>;
  }

  function renderSettings() {
    return <><div className="page-heading"><div><span className="breadcrumb">研究资料库 / 本地配置</span><h1>数据与设置</h1><p>管理本地数据、AI 辅助和备份。</p></div></div><section className="panel domain-settings-card"><div className="domain-settings-heading"><div><h3>独立研究领域</h3><p>每个空间单独保存论文库、标签标准、AI 分类上下文和地图权重。</p></div><button className="button button-dark" onClick={openCreateDomain}><Plus size={14} />新建领域</button></div><div className="domain-settings-list">{domains.map((domain) => <button key={domain.id} className={domain.id === activeDomainId ? "domain-settings-item domain-settings-item-active" : "domain-settings-item"} onClick={() => switchDomain(domain.id)}><span><b>{domain.name}</b><small>{domain.description || "尚未添加简介"}</small></span><em>{domain.id === activeDomainId ? `${papers.length} 篇当前论文` : "切换领域"}</em></button>)}</div></section><section className="panel ai-settings-card"><div className="ai-settings-heading"><span className="settings-icon settings-icon-blue"><Sparkles size={19} /></span><div><h3>DeepSeek 论文助手</h3><p>{!aiStatus.reachable ? "本机 AI 服务尚未连接。请使用 npm run dev 启动项目。" : aiStatus.configured ? `API Key 已配置 · ${aiStatus.model}` : "配置 API Key 后，可在导入和论文编辑时一键补全文献信息、翻译标题与摘要。"}</p></div><span className={`ai-status-pill ${aiStatus.configured ? "ai-status-ready" : ""}`}>{aiStatus.configured ? "已启用" : "未配置"}</span></div><form className="ai-key-form" onSubmit={storeAiKey}><label>DeepSeek API Key<input type="password" autoComplete="new-password" value={aiKeyDraft} onChange={(event) => setAiKeyDraft(event.target.value)} placeholder={aiStatus.configured ? "输入新密钥以更新" : "粘贴 sk-… API Key"} /></label><button className="button button-dark" disabled={aiSettingsBusy || !aiKeyDraft.trim()}>{aiSettingsBusy ? <Activity className="spin" size={15} /> : <KeyRound size={15} />}{aiStatus.configured ? "更新密钥" : "保存并启用"}</button>{aiStatus.configured && <button type="button" className="button button-light" disabled={aiSettingsBusy} onClick={removeAiKey}>移除密钥</button>}</form>{aiSettingsMessage && <p className="ai-settings-message" role="status">{aiSettingsMessage}</p>}<p className="ai-privacy-note"><LockKeyhole size={14} />密钥只写入本机 .env.local（已从 Git 排除）。点击 AI 操作时，论文元数据与 PDF 本地提取的文字片段会发送至 DeepSeek；PDF 文件本身不上传。AI 结果会作为候选信息保留，需人工校对后再标为已确认。</p></section><div className="settings-grid"><section className="panel storage-card"><div className="settings-icon"><LockKeyhole size={19} /></div><div><h3>本地数据存储</h3><p>论文信息、标签、阅读笔记、关系和 PDF 文件均保存在当前浏览器的 IndexedDB 中。数据不会自动同步到其他设备。</p><div className="storage-facts"><span><b>{papers.length}</b> 篇论文</span><span><b>{papers.filter((paper) => paper.pdfBlob).length}</b> 个 PDF 附件</span><span><b>离线</b> 可用</span></div></div></section><section className="panel settings-action"><div className="settings-icon settings-icon-blue"><ArrowDownToLine size={19} /></div><div><h3>导出完整备份</h3><p>打包论文记录和 PDF 附件为 JSON 文件，可用于迁移或恢复。</p><button className="button button-dark" onClick={exportBackup}><FileDown size={15} />导出备份</button></div></section><section className="panel settings-action"><div className="settings-icon settings-icon-green"><Archive size={19} /></div><div><h3>恢复备份</h3><p>默认合并新记录并保留现有内容；替换模式会覆盖当前数据库。</p><div className="restore-controls"><select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value)}><option value="merge">合并记录</option><option value="replace">替换数据库</option></select><button className="button button-light" onClick={() => backupInput.current?.click()}><Upload size={15} />选择备份文件</button><input ref={backupInput} type="file" accept="application/json,.json" onChange={(event) => restoreBackup(event.target.files?.[0])} hidden /></div></div></section><section className="panel settings-action"><div className="settings-icon settings-icon-amber"><SlidersHorizontal size={19} /></div><div><h3>地图相似度默认值</h3><p>当前视角为“{activePresetLabel}”。维度缺失时会重新归一化其余有效权重。</p><button className="button button-light" onClick={() => { changePreset('balanced'); setThreshold(55); setMaxEdges(3); }}>恢复默认地图设置</button></div></section></div><div className="settings-footnote"><Shield size={16} /><span>建议定期导出备份。清除浏览器站点数据会删除此设备上尚未备份的论文和附件。</span></div></>;
  }

  function renderPage() {
    if (page === 'overview') return renderOverview();
    if (page === 'library') return renderLibrary();
    if (page === 'map') return renderMap();
    if (page === 'compare') return renderCompare();
    if (page === 'reading') return renderReading();
    if (page === 'import') return renderImport();
    if (page === 'taxonomy') return renderTaxonomy();
    return renderSettings();
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="brand"><span className="brand-mark"><img src="/phishmap-logo.png" alt="" /></span><span><b>PhishMap</b><small>RESEARCH ATLAS</small></span><button className="mobile-close icon-button" onClick={() => setMobileNav(false)}><X size={17} /></button></div><div className="domain-switcher"><button className="project-label" aria-expanded={domainMenuOpen} onClick={() => setDomainMenuOpen((open) => !open)}><span className="project-dot" /><span className="domain-current-name">{activeDomain?.name || '研究领域'}</span><ChevronDown className={domainMenuOpen ? 'chevron-open' : ''} size={13} /></button>{domainMenuOpen && <div className="domain-menu" role="menu">{domains.map((domain) => <button key={domain.id} role="menuitem" className={domain.id === activeDomainId ? 'domain-option domain-option-active' : 'domain-option'} onClick={() => switchDomain(domain.id)}><span className="domain-option-mark">{domain.id === activeDomainId ? <Check size={13} /> : null}</span><span><b>{domain.name}</b><small>{domain.id === DEFAULT_DOMAIN_ID ? '默认领域' : '独立研究空间'}</small></span></button>)}<button className="domain-create-option" onClick={openCreateDomain}><Plus size={14} />新建研究领域</button></div>}</div><div className="nav-caption">研究空间</div><nav className="main-nav">{NAV_ITEMS.map(([key, label]) => { const Icon = NAV_ICONS[key]; return <button key={key} className={`nav-item ${page === key ? 'nav-active' : ''}`} onClick={() => { setPage(key); setMobileNav(false); }}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{key === 'library' && papers.length > 0 && <small>{papers.length}</small>}{key === 'import' && importQueue.length > 0 && <i>{importQueue.length}</i>}</button>; })}</nav><div className="sidebar-bottom"><div className="local-card"><span><LockKeyhole size={14} />本地优先</span><p>论文和 PDF 默认保存在此设备；使用 AI 时会按需发送文字资料。</p></div><div className="profile-row"><span className="profile-avatar">PM</span><span><b>个人研究空间</b><small>{loaded ? '本地数据库已连接' : '正在连接本地数据库'}</small></span><div className={`connection-dot ${loaded ? 'connected' : ''}`} /></div></div></aside>
    {mobileNav && <button className="mobile-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <main className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)}><Menu size={19} /></button><div className="breadcrumbs"><span>PhishMap</span><ArrowRight size={13} /><b>{NAV_ITEMS.find(([key]) => key === page)?.[1]}</b></div><label className="global-search"><Search size={15} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或标签…" /><kbd>⌘ K</kbd></label><button className="topbar-add" onClick={() => openEditor()}><Plus size={16} /><span>新建论文</span></button></header><div className={`content content-${page}`}>{renderPage()}</div></main>
    {editor && <PaperEditor editor={editor} setEditor={setEditor} updateDraft={updateDraft} onSubmit={submitEditor} onClose={() => setEditor(null)} tagGroups={tagGroups} domainName={activeDomain?.name || "研究领域"} aiStatus={aiStatus} onAiAssist={assistPaper} />}
    {newDomainOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewDomainOpen(false); }}><form className="domain-modal" onSubmit={createDomain} role="dialog" aria-modal="true" aria-labelledby="new-domain-title"><div className="domain-modal-heading"><span className="settings-icon settings-icon-green"><Layers3 size={19} /></span><div><h2 id="new-domain-title">新建研究领域</h2><p>独立保存论文、分类标准、地图偏好与导入队列。</p></div><button type="button" className="icon-button" onClick={() => setNewDomainOpen(false)} aria-label="关闭"><X size={17} /></button></div><label className="editor-field">研究领域名称<input autoFocus required maxLength={80} value={newDomainName} onChange={(event) => setNewDomainName(event.target.value)} placeholder="例如：医学影像分割" /></label><label className="editor-field">领域简介（可选）<textarea rows="3" maxLength={300} value={newDomainDescription} onChange={(event) => setNewDomainDescription(event.target.value)} placeholder="说明这个研究空间的主题或范围" /></label><div className="domain-modal-note"><Shield size={15} /><span>将建立一套通用分类标准。之后可在“分类体系”中为本领域增删标签；其它领域不会受影响。</span></div><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setNewDomainOpen(false)}>取消</button><button type="submit" className="button button-dark"><Plus size={15} />创建领域</button></div></form></div>}{conflict && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true"><div className="modal-icon modal-icon-amber"><CircleHelp size={20} /></div><h2>发现可能重复的论文</h2><p>这条记录与现有论文标题和年份或 DOI 相近。</p><div className="duplicate-pair"><span>现有记录</span><b>{conflict.match.title}</b><span>准备添加</span><b>{conflict.paper.title}</b></div><div className="modal-actions"><button className="button button-light" onClick={() => setConflict(null)}>返回检查</button><button className="button button-dark" onClick={async () => { const data = conflict; if (data.queueId) await addQueueDirect({ queueId: data.queueId, paper: data.paper }, true); else { await persistPaper(data.paper); setSelectedId(data.paper.id); setEditor(null); flash('论文记录已保存。'); } setConflict(null); }}>仍然添加</button></div></section></div>}
    {toast && <div className="toast-message"><Check size={15} />{toast}</div>}
  </div>;
}

function MultiSelectFilter({ title, values, options, onChange }) {
  return <details className="multi-filter"><summary>{values.length ? `${title} · ${values.length}` : `全部${title}`}</summary><div className="multi-filter-options">{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((value) => value !== option))} />{option}</label>)}{values.length > 0 && <button type="button" onClick={() => onChange([])}>清除选择</button>}</div></details>;
}

function PaperEditor({ editor, setEditor, updateDraft, onSubmit, onClose, tagGroups, domainName, aiStatus, onAiAssist }) {
  const paper = editor.paper;
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  async function assistCurrentPaper() {
    setAiBusy(true); setAiMessage('');
    try {
      const enriched = await onAiAssist(paper);
      setEditor((current) => ({ ...current, paper: enriched }));
      const filled = ['title', 'authors', 'year', 'venue', 'doi', 'publicationUrl', 'abstract', 'titleZh', 'abstractZh'].filter((key) => !paper[key]?.length && enriched[key]?.length).length;
      const conflicts = enriched.aiReview?.discrepancies?.length || 0;
      setAiMessage(`已生成候选内容，填入 ${filled} 项空白字段${conflicts ? `，另发现 ${conflicts} 项信息差异` : ''}。请检查后再保存。`);
    } catch (error) { setAiMessage(error.message); }
    finally { setAiBusy(false); }
  }
  const [experimentDraft, setExperimentDraft] = useState({ dataset: '', version: '', setting: '', baselines: '', metrics: '', ablation: '', generalization: '', reproducibility: '' });
  function toggleTag(key, value) { const current = paper.tags[key] || []; const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]; setEditor((old) => ({ ...old, paper: { ...old.paper, tags: { ...old.paper.tags, [key]: next } } })); }
  function addExperiment(event) {
    event?.preventDefault();
    if (!experimentDraft.dataset.trim() && !experimentDraft.setting.trim() && !experimentDraft.metrics.trim()) return;
    const metrics = experimentDraft.metrics.split(/[;\n]/).map((item) => item.trim()).filter(Boolean).map((item) => { const [name, ...value] = item.split('='); return { name: name.trim(), value: value.join('=').trim() || '未记录数值' }; });
    const experiment = { id: crypto.randomUUID(), ...experimentDraft, metrics };
    const datasets = experimentDraft.dataset.trim() ? [...new Set([...paper.tags.datasets, experimentDraft.dataset.trim()])] : paper.tags.datasets;
    const evaluationSettings = experimentDraft.setting.trim() ? [...new Set([...paper.tags.evaluationSettings, experimentDraft.setting.trim()])] : paper.tags.evaluationSettings;
    setEditor((old) => ({ ...old, paper: { ...old.paper, experiments: [...old.paper.experiments, experiment], tags: { ...old.paper.tags, datasets, evaluationSettings } } }));
    setExperimentDraft({ dataset: '', version: '', setting: '', baselines: '', metrics: '', ablation: '', generalization: '', reproducibility: '' });
  }
  function removeExperiment(id) { setEditor((old) => ({ ...old, paper: { ...old.paper, experiments: old.paper.experiments.filter((experiment) => experiment.id !== id) } })); }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="editor-modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="editor-header"><div><span className="panel-kicker">论文元数据 · 研究分析</span><h2 id="editor-title">{paper.title ? '编辑论文记录' : '新建论文记录'}</h2><p>自动提取内容保留为候选值，确认后才进入分类相似度计算。</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭编辑"><X size={18} /></button></div><div className="editor-body"><section className="editor-section"><div className="editor-section-heading ai-editor-heading"><div><h3>文献信息</h3><p>AI 可从当前字段和 PDF 文字中整理候选值，原有信息不会被覆盖。</p></div><button type="button" className="button button-dark" onClick={assistCurrentPaper} disabled={!aiStatus?.configured || aiBusy}>{aiBusy ? <Activity className="spin" size={15} /> : <Sparkles size={15} />}{aiBusy ? '正在分析…' : 'AI 补全并翻译'}</button></div>{!aiStatus?.configured && <p className="ai-inline-hint">先在“数据与设置”配置 DeepSeek API Key，再使用 AI 助手。</p>}{aiMessage && <p className="ai-inline-message" role="status">{aiMessage}</p>}{paper.aiReview && <div className="ai-review-panel"><div className="ai-review-title"><span><Sparkles size={14} />DeepSeek 候选整理</span><small>{paper.aiReview.model} · {fmtDate(paper.aiReview.generatedAt)}</small></div>{paper.aiReview.discrepancies?.length > 0 && <div className="ai-review-conflicts"><b>现有信息与候选结果不同，原值已保留</b>{paper.aiReview.discrepancies.map((item, index) => <p key={`${item.field}-${index}`}>{item.label}：当前「{item.current}」／候选「{item.candidate}」</p>)}</div>}{paper.aiReview.notes?.length > 0 && <ul>{paper.aiReview.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}{paper.aiReview.evidence?.length > 0 && <details><summary>查看原文依据（{paper.aiReview.evidence.length} 项）</summary><div className="ai-evidence-list">{paper.aiReview.evidence.map((item, index) => <p key={`${item.field}-${index}`}><b>{AI_FIELD_LABELS[item.field] || item.field || '候选字段'}</b><span>{item.confidence || 'low'} 置信度</span><q>{item.excerpt}</q></p>)}</div></details>}</div>}<div className="editor-grid"><label className="editor-field span-two">论文标题<input required={!paper.pdfBlob && !paper.bibtex} value={paper.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder={paper.pdfBlob ? '标题未识别，可稍后校对' : '填写论文标题'} /></label><label className="editor-field span-two">作者（以逗号分隔）<input value={paper.authors.join(', ')} onChange={(event) => updateDraft('authors', event.target.value.split(/,\s*/).filter(Boolean))} placeholder="作者姓名" /></label><label className="editor-field">年份<input value={paper.year} onChange={(event) => updateDraft('year', event.target.value)} placeholder="2024" /></label><label className="editor-field">期刊 / 会议<input value={paper.venue} onChange={(event) => updateDraft('venue', event.target.value)} placeholder="Venue" /></label><label className="editor-field">DOI<input value={paper.doi} onChange={(event) => updateDraft('doi', event.target.value)} placeholder="10.xxxx/…" /></label><label className="editor-field">发表页面<input value={paper.publicationUrl} onChange={(event) => updateDraft('publicationUrl', event.target.value)} placeholder="https://…" /></label><label className="editor-field span-two">摘要<textarea rows="4" value={paper.abstract} onChange={(event) => updateDraft('abstract', event.target.value)} placeholder="可留空；缺失摘要不会被当作零相似度。" /></label><label className="editor-field span-two">标题中文翻译<input value={paper.titleZh || ""} onChange={(event) => updateDraft('titleZh', event.target.value)} placeholder="AI 翻译候选，可人工修改" /></label><label className="editor-field span-two">摘要中文翻译<textarea rows="4" value={paper.abstractZh || ""} onChange={(event) => updateDraft('abstractZh', event.target.value)} placeholder="AI 翻译候选，可人工修改" /></label><label className="editor-field">元数据状态<select value={paper.verificationStatus} onChange={(event) => updateDraft('verificationStatus', event.target.value)}><option>Missing</option><option>Automatically Extracted</option><option>Manually Edited</option><option>Verified</option></select></label><label className="editor-field">阅读状态<select value={paper.readingStatus} onChange={(event) => updateDraft('readingStatus', event.target.value)}>{READING_STATES.map((state) => <option key={state}>{state}</option>)}</select></label><label className="editor-field span-two">关联 PDF<input type="text" value={paper.pdfName || ''} readOnly placeholder="未关联 PDF（可从导入中心添加）" /></label></div></section>
        <section className="editor-section taxonomy-editor"><div className="editor-section-heading"><div><h3>{domainName} · 分类标签</h3><p>标签可多选；标注状态决定是否参与相似度计算。</p></div></div>{tagGroups.map(([key, label, terms, dimension]) => <div className="tag-editor-row" key={key}><div className="tag-editor-heading"><b>{label}</b>{dimension && <label>状态<select value={paper.tagStatus[dimension] || 'Unknown'} onChange={(event) => setEditor((old) => ({ ...old, paper: { ...old.paper, tagStatus: { ...old.paper.tagStatus, [dimension]: event.target.value } } }))}><option value="Unknown">未知</option><option value="Suggested">建议</option><option value="Confirmed">已确认</option><option value="Not Reported">未报告</option></select></label>}</div><div className="checkbox-chips">{terms.map((term) => <label className={paper.tags[key]?.includes(term) ? 'chip-checked' : ''} key={term}><input type="checkbox" checked={paper.tags[key]?.includes(term) || false} onChange={() => toggleTag(key, term)} /><span>{term}</span></label>)}</div></div>)}
          {paper.tags.modalities.length > 0 && <div className="modality-role-editor"><div className="tag-editor-heading"><b>输入模态角色</b><span>区分原始输入与派生表示</span></div>{paper.tags.modalities.map((modality) => <div className="modality-role-row" key={modality}><b>{modality}</b><select value={paper.modalityRoles?.[modality]?.role || 'primary'} onChange={(event) => setEditor((old) => ({ ...old, paper: { ...old.paper, modalityRoles: { ...old.paper.modalityRoles, [modality]: { ...old.paper.modalityRoles?.[modality], role: event.target.value } } } }))}><option value="primary">模型主要输入</option><option value="auxiliary">辅助输入</option><option value="derived">预处理派生表示</option><option value="experiment">仅用于实验</option></select><input value={paper.modalityRoles?.[modality]?.representation || ''} onChange={(event) => setEditor((old) => ({ ...old, paper: { ...old.paper, modalityRoles: { ...old.paper.modalityRoles, [modality]: { ...old.paper.modalityRoles?.[modality], representation: event.target.value } } } }))} placeholder="可说明来源，如 Screenshot → OCR Text" /></div>)}</div>}
          <div className="editor-grid dataset-fields"><label className="editor-field">数据集（逗号分隔）<input value={paper.tags.datasets.join(', ')} onChange={(event) => setEditor((old) => ({ ...old, paper: { ...old.paper, tags: { ...old.paper.tags, datasets: event.target.value.split(/,\s*/).filter(Boolean) } } }))} placeholder="例如：PhishTank, OpenPhish" /></label><label className="editor-field">评价设置（逗号分隔）<input value={paper.tags.evaluationSettings.join(', ')} onChange={(event) => setEditor((old) => ({ ...old, paper: { ...old.paper, tags: { ...old.paper.tags, evaluationSettings: event.target.value.split(/,\s*/).filter(Boolean) } } }))} placeholder="例如：cross-domain, temporal" /></label><label className="editor-field">具体模型名称<input value={paper.modelNames || ''} onChange={(event) => updateDraft('modelNames', event.target.value)} placeholder="例如：BERT, ResNet-50" /></label></div>
        </section><section className="editor-section"><div className="editor-section-heading"><div><h3>实验记录</h3><p>分别保存数据集、评估设置和指标，避免跨实验直接比较数值。</p></div></div>{paper.experiments.map((experiment) => <article className="experiment-record" key={experiment.id}><div><b>{experiment.dataset || '数据集未记录'}</b><span>{experiment.version || '版本未记录'} · {experiment.setting || '评估设置未记录'}</span><p>{(experiment.metrics || []).map((metric) => `${metric.name}: ${metric.value}`).join(' · ') || '未报告指标'}{experiment.baselines ? ` · 基线：${experiment.baselines}` : ''}{experiment.ablation ? ` · 消融：${experiment.ablation}` : ''}{experiment.generalization ? ` · 泛化：${experiment.generalization}` : ''}{experiment.reproducibility ? ` · 复现：${experiment.reproducibility}` : ''}</p></div><button type="button" className="icon-button tiny" onClick={() => removeExperiment(experiment.id)} aria-label="删除实验记录"><Trash2 size={13} /></button></article>)}<div className="experiment-form"><div className="editor-grid"><label className="editor-field">数据集名称<input value={experimentDraft.dataset} onChange={(event) => setExperimentDraft({ ...experimentDraft, dataset: event.target.value })} placeholder="Dataset" /></label><label className="editor-field">版本 / 划分<input value={experimentDraft.version} onChange={(event) => setExperimentDraft({ ...experimentDraft, version: event.target.value })} placeholder="version / split" /></label><label className="editor-field">评估设置<input value={experimentDraft.setting} onChange={(event) => setExperimentDraft({ ...experimentDraft, setting: event.target.value })} placeholder="例如：cross-domain" /></label><label className="editor-field">对比基线<input value={experimentDraft.baselines} onChange={(event) => setExperimentDraft({ ...experimentDraft, baselines: event.target.value })} placeholder="Baselines" /></label><label className="editor-field">指标与数值<textarea rows="2" value={experimentDraft.metrics} onChange={(event) => setExperimentDraft({ ...experimentDraft, metrics: event.target.value })} placeholder={'每行一个，例如：\nF1 = 0.94\nAUC = 0.98'} /></label><label className="editor-field">消融观察<textarea rows="2" value={experimentDraft.ablation} onChange={(event) => setExperimentDraft({ ...experimentDraft, ablation: event.target.value })} placeholder="未记录" /></label><label className="editor-field">泛化设置<textarea rows="2" value={experimentDraft.generalization} onChange={(event) => setExperimentDraft({ ...experimentDraft, generalization: event.target.value })} placeholder="未记录" /></label><label className="editor-field">复现信息<textarea rows="2" value={experimentDraft.reproducibility} onChange={(event) => setExperimentDraft({ ...experimentDraft, reproducibility: event.target.value })} placeholder="未记录" /></label></div><button className="button button-light" type="button" onClick={addExperiment}><Plus size={14} />添加实验记录</button></div></section><section className="editor-section"><h3>研究分析卡片</h3><div className="editor-grid">{ANALYSIS_FIELDS.map(([key, label]) => <label className="editor-field" key={key}>{label}<textarea rows="2" value={paper.analysis[key] || ''} onChange={(event) => setEditor((old) => ({ ...old, paper: { ...old.paper, analysis: { ...old.paper.analysis, [key]: event.target.value } } }))} placeholder="未记录" /></label>)}</div></section></div><div className="editor-footer"><span>{paper.pdfName ? `已关联：${paper.pdfName}` : 'PDF 可从导入中心关联'}</span><button type="button" className="button button-light" onClick={onClose}>取消</button><button className="button button-dark" type="submit"><Check size={15} />保存论文</button></div></form></div>;
}

function EdgeDetails({ edge, papers, onClose }) {
  const left = papers.find((paper) => paper.id === edge.source); const right = papers.find((paper) => paper.id === edge.target);
  if (!left || !right) return null;
  return <section className="panel edge-details"><div className="side-heading"><div><h3>{edge.type === 'computed' ? '计算相似关系' : '人工确认关系'}</h3><p>{edge.type === 'computed' ? '算法估计，不代表引用或继承' : edge.relationType}</p></div><button className="icon-button" onClick={onClose}><X size={14} /></button></div><b className="edge-paper-name">{left.title}</b><span className="edge-connector"><GitBranch size={13} /></span><b className="edge-paper-name">{right.title}</b>{edge.type === 'computed' ? <><div className="edge-score"><strong>{Math.round(edge.score * 100)}<small>%</small></strong><span>总体相似度</span></div><div className="coverage-note">信息覆盖度 {Math.round(edge.coverage * 100)}% · 按有效维度重新归一化</div><div className="score-list">{DIMENSIONS.map(([key]) => <div key={key}><span>{dimensionTitle[key]}</span>{edge.dimensions[key] == null ? <em>不可计算</em> : <><div className="score-bar"><i style={{ width: `${edge.dimensions[key] * 100}%` }} /></div><b>{Math.round(edge.dimensions[key] * 100)}%</b>{edge.overlaps?.[key]?.length > 0 && <small className="score-shared">共同项：{edge.overlaps[key].slice(0, 5).join('、')}</small>}</>}</div>)}</div><div className="missing-note"><CircleHelp size={14} />缺少摘要或未确认分类的维度不会记为零分。</div></> : <p className="explicit-explanation">{edge.explanation || '已由用户确认关系。'}</p>}</section>;
}

function cellValue(paper, key) {
  const a = paper.analysis || {}; const t = paper.tags || {};
  if (key === 'task') return list(t.tasks).join(', ');
  if (key === 'modalities') return list(t.modalities).join(', ');
  if (key === 'architecture') return [...list(t.architectures), paper.modelNames].filter(Boolean).join(', ');
  if (key === 'fusion') return list(t.fusionStages).join(', ');
  if (key === 'mechanism') return list(t.mechanisms).join(', ');
  if (key === 'objective') return list(t.objectives).join(', ');
  if (key === 'datasets') return list(t.datasets).join(', ');
  if (key === 'evaluationSettings') return list(t.evaluationSettings).join(', ');
  if (key === 'metrics') return (paper.experiments || []).flatMap((experiment) => (experiment.metrics || []).map((metric) => `${metric.name}: ${metric.value} (${experiment.dataset || '数据集未记录'})`)).join('; ');
  if (key === 'featureExtractors') return a.featureExtractors || '';
  if (key === 'contributions') return a.contributions || '';
  if (key === 'limitations') return a.limitations || '';
  return '';
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer(); let binary = ''; const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${blob.type || 'application/pdf'};base64,${btoa(binary)}`;
}
function base64ToBlob(base64, type) {
  const binary = atob(base64); const chunks = [];
  for (let index = 0; index < binary.length; index += 0x8000) { const slice = binary.slice(index, index + 0x8000); const bytes = new Uint8Array(slice.length); for (let j = 0; j < slice.length; j += 1) bytes[j] = slice.charCodeAt(j); chunks.push(bytes); }
  return new Blob(chunks, { type });
}
function useMemoPdfUrl(blob) {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!blob) { setUrl(''); return undefined; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}

export default App;
