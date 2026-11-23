import React, { useRef, useState } from 'react';
import { Activity, ImagePlus, MessageSquareText, Send, Sparkles, X } from 'lucide-react';

const IMAGE_LIMIT = 3_200_000;

async function prepareScreenshot(file) {
  if (!file?.type.startsWith('image/')) throw new Error('请选择图片格式的截图。');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let dataUrl = canvas.toDataURL('image/jpeg', .82);
  if (dataUrl.length > IMAGE_LIMIT) dataUrl = canvas.toDataURL('image/jpeg', .64);
  if (dataUrl.length > IMAGE_LIMIT) throw new Error('截图仍然太大，请裁剪后再添加。');
  return { dataUrl, name: file.name || '剪贴板截图.jpg' };
}

export default function ReadingAssistant({ paper, selectedText, selectedPage, aiStatus, onAsk, onSaveTurn, onSaveNote, onClearSelection }) {
  const [question, setQuestion] = useState('');
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const messages = paper.readingChat || [];

  async function attachImage(file) {
    try { setImage(await prepareScreenshot(file)); setError(''); }
    catch (imageError) { setError(imageError.message || '无法读取截图。'); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handlePaste(event) {
    const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'));
    const file = imageItem?.getAsFile();
    if (file) { event.preventDefault(); await attachImage(file); }
  }

  async function submit(prompt = question.trim()) {
    if (!prompt && !selectedText && !image) { setError('先输入问题、选择 PDF 原文，或添加截图。'); return; }
    if (!aiStatus?.configured) { setError('请先在“数据与设置”配置 DeepSeek API Key。'); return; }
    setBusy(true); setError('');
    try {
      const answer = await onAsk({ question: prompt, selectedText, page: selectedPage || '', image: image?.dataUrl || '', history: messages.slice(-6).map(({ question: pastQuestion, answer: pastAnswer }) => ({ question: pastQuestion, answer: pastAnswer })) });
      const turn = { id: crypto.randomUUID(), question: prompt || (selectedText ? '请解释这段选中的内容。' : '请解释截图中的内容。'), answer, selectedText: selectedText || '', page: selectedPage || '', imageAttached: Boolean(image), imageData: image?.dataUrl || '', imageName: image?.name || '', createdAt: new Date().toISOString() };
      await onSaveTurn(turn);
      setQuestion(''); setImage(null);
    } catch (requestError) { setError(requestError.message || 'AI 请求失败，请重试。'); }
    finally { setBusy(false); }
  }

  async function saveAnswerAsNote(turn) {
    const sources = [];
    if (turn.selectedText) sources.push(`原文摘录${turn.page ? `（第 ${turn.page} 页）` : ''}：\n${turn.selectedText}`);
    if (turn.imageAttached) sources.push(`依据截图${turn.page ? `（第 ${turn.page} 页）` : ''}整理${turn.imageName ? `，截图：${turn.imageName}` : ''}。`);
    const content = [...sources, `问题：${turn.question}`, `AI 回答：\n${turn.answer}`].join('\n\n');
    try {
      await onSaveNote({ id: crypto.randomUUID(), sourceId: turn.id, type: 'AI 阅读问答', content, page: turn.page || '', createdAt: new Date().toISOString() });
      setError('');
    } catch (saveError) { setError(saveError.message || '笔记保存失败，请重试。'); }
  }

  return <section className="reading-ai panel">
    <div className="reading-ai-heading"><span className="reading-ai-icon"><Sparkles size={15} /></span><div><h3>原文 AI 助手</h3><p>选中 PDF 文字，或粘贴 / 添加截图，再提问并保存为笔记。</p></div><span className={`reading-ai-status ${aiStatus?.configured ? 'ready' : ''}`}>{aiStatus?.configured ? 'DeepSeek 已配置' : '需配置 API'}</span></div>
    {selectedText && <div className="reading-ai-selection"><div><b>已选原文</b>{selectedPage ? <span>第 {selectedPage} 页</span> : null}<button className="text-button small" type="button" onClick={onClearSelection}>清除</button></div><p>{selectedText}</p></div>}
    {messages.length > 0 && <div className="reading-ai-messages">{messages.map((turn) => <article className="reading-ai-turn" key={turn.id}><div className="reading-ai-question"><MessageSquareText size={13} /><span>{turn.question}</span></div>{turn.selectedText && <blockquote>{turn.selectedText}{turn.page ? <small> · 第 {turn.page} 页</small> : null}</blockquote>}{turn.imageAttached && <><small className="reading-ai-image-note">此轮问题包含截图{turn.imageName ? ` · ${turn.imageName}` : ''}</small>{turn.imageData && <img className="reading-ai-turn-image" src={turn.imageData} alt="问答中使用的截图" />}</>}<p className="reading-ai-answer">{turn.answer}</p><div className="reading-ai-turn-footer"><time>{new Date(turn.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>{paper.notes?.some((note) => note.sourceId === turn.id) ? <span className="reading-ai-saved">已记入笔记</span> : <button type="button" className="text-button small" onClick={() => saveAnswerAsNote(turn)}>记为笔记</button>}</div></article>)}</div>}
    <div className="reading-ai-composer"><div className="reading-ai-composer-tools"><button className="button button-light" type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />添加截图</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => event.target.files?.[0] && attachImage(event.target.files[0])} /><span>也可直接在问题框粘贴截图</span></div>{image && <div className="reading-ai-attachment"><img src={image.dataUrl} alt="待发送截图预览" /><span>{image.name}</span><button type="button" className="icon-button tiny" onClick={() => setImage(null)} aria-label="移除截图"><X size={12} /></button></div>}<textarea value={question} onChange={(event) => setQuestion(event.target.value)} onPaste={handlePaste} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); } }} placeholder={selectedText ? '询问这段原文，例如：翻译并解释核心方法…' : '输入问题，或先在左侧 PDF 选中原文…'} rows="3" /><div className="reading-ai-actions"><span>提交时还会发送论文基本信息和最近 6 轮文字问答。</span><button type="button" className="button button-dark" onClick={() => submit()} disabled={busy || !aiStatus?.configured}>{busy ? <Activity className="spin" size={14} /> : <Send size={14} />}{busy ? '正在回答…' : '提问'}</button></div><div className="reading-ai-shortcuts"><button type="button" onClick={() => submit('请准确翻译我选中的内容，保留术语和限定条件。')} disabled={!selectedText || busy || !aiStatus?.configured}>翻译选中内容</button><button type="button" onClick={() => submit('请用中文解释我选中的内容，并指出关键术语。')} disabled={!selectedText || busy || !aiStatus?.configured}>解释这段原文</button><button type="button" onClick={() => submit('请概括截图中的主要信息，并解释图表或结构。')} disabled={!image || busy || !aiStatus?.configured}>解释截图</button></div>{error && <p className="reading-ai-error" role="status">{error}</p>}</div>
    <p className="reading-ai-privacy">点击提问后，当前论文基本信息、问题、所选文字 / 当前截图及最近 6 轮文字问答会发送给 DeepSeek；截图与记录保存在本机，PDF 文件本身不上传。</p>
  </section>;
}
