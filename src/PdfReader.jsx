import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({ file, onSelection, onPageChange }) {
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const onPageChangeRef = useRef(onPageChange);
  const onSelectionRef = useRef(onSelection);
  const pageNumberRef = useRef(pageNumber);
  const lastSelectionRef = useRef('');
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState('');

  onPageChangeRef.current = onPageChange;
  onSelectionRef.current = onSelection;
  pageNumberRef.current = pageNumber;

  useEffect(() => {
    let cancelled = false;
    let loadingTask;
    setPdf(null); setPageNumber(1); setError('');
    if (!file) return undefined;
    file.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      return loadingTask.promise;
    }).then((document) => { if (!cancelled && document) setPdf(document); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || '无法读取这份 PDF。'); });
    return () => { cancelled = true; loadingTask?.destroy().catch(() => {}); };
  }, [file]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return undefined;
    let cancelled = false;
    let renderTask;
    let textLayer;
    const canvas = canvasRef.current;
    const canvasContext = canvas.getContext('2d', { alpha: false });
    const textContainer = textLayerRef.current;
    textContainer.replaceChildren();
    setError('');
    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.max(.35, (containerWidth || baseViewport.width) / baseViewport.width - .035);
      const viewport = page.getViewport({ scale: Math.min(1.7, fitScale * zoom) });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      textContainer.style.width = `${viewport.width}px`;
      textContainer.style.height = `${viewport.height}px`;
      canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const textContent = await page.getTextContent();
      textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textContainer, viewport });
      renderTask = page.render({ canvasContext, viewport });
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (!cancelled) onPageChangeRef.current?.(pageNumber);
    }).catch((renderError) => { if (!cancelled && renderError?.name !== 'RenderingCancelledException') setError(renderError.message || 'PDF 页面渲染失败。'); });
    return () => { cancelled = true; renderTask?.cancel(); textLayer?.cancel(); };
  }, [pdf, pageNumber, zoom, containerWidth]);

  function captureSelection() {
    const layer = textLayerRef.current;
    const selection = window.getSelection();
    if (!layer || !selection) return;
    const text = selection?.toString().trim() || '';
    if (!text) {
      if (lastSelectionRef.current) {
        lastSelectionRef.current = '';
        onSelectionRef.current?.({ text: '', page: pageNumberRef.current });
      }
      return;
    }
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    const startsInPdf = range && layer.contains(range.startContainer);
    const endsInPdf = range && layer.contains(range.endContainer);
    if (!startsInPdf && !endsInPdf) return;
    const nextText = text.slice(0, 20_000);
    if (nextText === lastSelectionRef.current) return;
    lastSelectionRef.current = nextText;
    onSelectionRef.current?.({ text: nextText, page: pageNumberRef.current });
  }

  useEffect(() => {
    let animationFrame = 0;
    const scheduleCapture = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => { animationFrame = 0; captureSelection(); });
    };
    document.addEventListener('selectionchange', scheduleCapture);
    document.addEventListener('pointerup', scheduleCapture);
    document.addEventListener('keyup', scheduleCapture);
    return () => {
      document.removeEventListener('selectionchange', scheduleCapture);
      document.removeEventListener('pointerup', scheduleCapture);
      document.removeEventListener('keyup', scheduleCapture);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, []);

  function movePage(delta) {
    setPageNumber((current) => Math.max(1, Math.min(pdf?.numPages || 1, current + delta)));
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    window.getSelection()?.removeAllRanges();
    lastSelectionRef.current = '';
  }

  if (error && !pdf) return <div className="pdf-reader-error">{error}</div>;
  if (!pdf) return <div className="pdf-reader-loading">正在打开 PDF…</div>;
  return <div className="pdf-reader">
    <div className="pdf-reader-toolbar"><div className="pdf-page-controls"><button className="icon-button" disabled={pageNumber <= 1} onClick={() => movePage(-1)} aria-label="上一页"><ChevronLeft size={15} /></button><span>第 <b>{pageNumber}</b> / {pdf.numPages} 页</span><button className="icon-button" disabled={pageNumber >= pdf.numPages} onClick={() => movePage(1)} aria-label="下一页"><ChevronRight size={15} /></button></div><div className="pdf-zoom-controls"><span>选中原文可在右侧提问</span><button className="icon-button" onClick={() => setZoom((value) => Math.max(.7, Number((value - .1).toFixed(2))))} aria-label="缩小 PDF"><Minus size={13} /></button><button className="icon-button" onClick={() => setZoom((value) => Math.min(1.6, Number((value + .1).toFixed(2))))} aria-label="放大 PDF"><Plus size={13} /></button></div></div>
    <div className="pdf-reader-scroll" ref={scrollRef}><div className="pdf-page-surface"><canvas ref={canvasRef} aria-hidden="true" /><div ref={textLayerRef} className="textLayer pdf-text-layer" /></div>{error && <p className="pdf-page-error">{error}</p>}</div>
  </div>;
}
