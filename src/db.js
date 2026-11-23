import { createDefaultDomain, DEFAULT_DOMAIN_ID } from './model.js';

const DB_NAME = 'phishmap-local';
const DB_VERSION = 2;
const STORE = 'papers';
const DOMAIN_STORE = 'domains';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const papers = db.objectStoreNames.contains(STORE) ? tx.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: 'id' });
      const domains = db.objectStoreNames.contains(DOMAIN_STORE) ? tx.objectStore(DOMAIN_STORE) : db.createObjectStore(DOMAIN_STORE, { keyPath: 'id' });
      if (!papers.indexNames.contains('domainId')) papers.createIndex('domainId', 'domainId', { unique: false });
      if (event.oldVersion < 2) domains.put(createDefaultDomain());
      if (event.oldVersion < 2 && event.oldVersion > 0) {
        const cursor = papers.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (!row.value.domainId) row.update({ ...row.value, domainId: DEFAULT_DOMAIN_ID });
          row.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllPapers(domainId = DEFAULT_DOMAIN_ID) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).index('domainId').getAll(IDBKeyRange.only(domainId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getResearchDomains() {
  const db = await openDb();
  const domains = await new Promise((resolve, reject) => {
    const request = db.transaction(DOMAIN_STORE, 'readonly').objectStore(DOMAIN_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  if (domains.length) return domains;
  const fallback = createDefaultDomain();
  await saveResearchDomain(fallback);
  return [fallback];
}

export async function saveResearchDomain(domain) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOMAIN_STORE, 'readwrite');
    tx.objectStore(DOMAIN_STORE).put(domain);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function savePaper(paper) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...paper, updatedAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function savePapers(papers) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    papers.forEach((paper) => store.put(paper));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function replaceDomainPapers(domainId, papers) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const cursorRequest = store.index('domainId').openCursor(IDBKeyRange.only(domainId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      papers.forEach((paper) => store.put({ ...paper, domainId }));
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function removePaper(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
