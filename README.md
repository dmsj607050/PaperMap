# PhishMap

PhishMap is a local-first research atlas for organizing literature across independent research domains. Each domain has its own paper library, taxonomy, import queue, map preferences, and AI classification context. The original phishing webpage detection library remains the default domain. Paper records and PDF attachments live in the browser's IndexedDB. Optional AI assistance runs only after you request it; it sends the current paper metadata and locally extracted text to DeepSeek, never the PDF file itself.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. After installing dependencies, the app's core workflows run without external services or network calls. Keep using the same browser profile and local origin to access the same library.

### Research domains

Use the domain picker at the top of the sidebar to switch spaces or create a new one. A new domain starts with a general purpose taxonomy; edit its labels in **分类体系**. Papers, queues, label standards, AI classification prompts, and map-weight presets are saved separately for each domain. Existing phishing research records are migrated into the default phishing domain when the database is upgraded.

### Optional DeepSeek paper assistant

Open **数据与设置**, paste your DeepSeek API Key, and choose **保存并启用**. PhishMap writes the key to the ignored `.env.local` file on this computer and keeps it out of browser storage and the client bundle. The development server is bound to `127.0.0.1`.

Use **AI 补全** in the import queue or **AI 补全并翻译** in a paper editor. The assistant proposes missing bibliographic fields, Chinese title/abstract translations, research-card notes, and labels drawn from the active domain's taxonomy. For a PDF, the browser extracts text locally from up to eight pages and sends up to 24,000 characters only when you click an AI action; the PDF bytes are not uploaded. Existing non-empty fields are preserved, suggested tags remain unconfirmed, and the model does not independently search publication databases. Review its source excerpts and verify the candidates before marking a record as confirmed.

AI use requires a DeepSeek API key and may incur charges under the account's current API pricing. Remove the key from **数据与设置** to disable AI requests.

To create a static production bundle:

```powershell
npm run build
npm run preview
```

## Included workflows

- Import multiple PDFs and `.bib` files into a review queue. PDF.js extracts text from the first four pages and offers title, year, DOI, and abstract as candidate metadata; scan-only PDFs need manual entry.
- Edit bibliographic fields, set verification state, apply multi-select taxonomy labels, and confirm label status independently.
- Search and filter the library; track reading status, reproduction attempts, analysis cards, experiments, notes, and page-based evidence.
- Explore a relationship map with modality/task/year filters, category coloring, zoom/pan, threshold and neighbor controls, adjustable similarity weights, and saved weight presets.
- Inspect per-dimension similarity scores and data coverage. Dashed edges are computed similarity; solid edges are manually confirmed relations.
- Compare 2–4 papers in a matrix and export Markdown or CSV.
- Export the active domain's JSON backup, including its taxonomy and embedded PDFs. Restore by merging or replacing papers in the active domain only.

## Data and research notes

- The database is per browser profile and origin. Use **Data & Settings → Export full backup** for migration and recovery.
- A backup with many large PDFs can become a large JSON download because attachments are embedded as Base64.
- PDF text extraction is heuristic and never marks extracted metadata as verified. It does not perform OCR.
- AI suggestions are unverified candidates. When explicitly requested, paper metadata and extracted PDF text may be sent to DeepSeek; the local PDF file remains in the browser database.
- Classification similarity uses confirmed taxonomy fields. Missing fields do not count as zero; valid dimensions are reweighted. Text similarity is local TF-IDF over paper titles and abstracts.
- Computed similarity is not a citation or a claim of influence. Only manually confirmed relation records appear as explicit relations.
- No sample papers are preloaded. The empty state avoids putting invented paper details into a research library.

## Project structure

- `src/App.jsx` — app pages and paper workflows
- `src/model.js` — taxonomy, BibTeX parsing, and similarity calculations
- `src/db.js` — IndexedDB persistence
- `src/pdf.js` — local PDF text extraction
- `src/styles.css` — responsive UI and map presentation
