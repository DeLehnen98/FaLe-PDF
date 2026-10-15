// Document, spreadsheet and presentation templates (own designs). All texts are placeholders to overwrite.
import { SHEET_TEMPLATE_LIST } from './sheet-templates.js';
import { DOC_TEMPLATE_LIST, DOC_TEMPLATE_CATS, buildDocTemplate } from './doc-templates.js';

// Document templates live in doc-templates.js (pure data, reusable outside the editor); this is the gallery list.
export const DOC_TEMPLATES = DOC_TEMPLATE_LIST.map(t => ({ ...t, icon: 'kdoc', kind: 'docx', html: () => buildDocTemplate(t.id).html }));
export { buildDocTemplate, DOC_TEMPLATE_LIST, DOC_TEMPLATE_CATS };

// ---------------- spreadsheet templates ----------------
// Spreadsheet templates live in sheet-templates.js (pure data + builder); this is the gallery list.
export const SHEET_TEMPLATES = SHEET_TEMPLATE_LIST.map(t => ({ ...t, icon: 'ksheet', kind: 'xlsx' }));

// ---------------- presentation themes (own designs) ----------------
export const SLIDE_THEMES = [
  { id: 'indigo', name: 'Indigo', bg: '#1E1B5E', title: '#FFFFFF', text: '#D9DAF7', accent: '#2DD4BF', font: 'Arial' },
  { id: 'papier', name: 'Papier', bg: '#FFFFFF', title: '#15172F', text: '#4F5475', accent: '#3B37A0', font: 'Arial' },
  { id: 'koralle', name: 'Koralle', bg: '#FFF6F0', title: '#3A1F17', text: '#5C4038', accent: '#E8613C', font: 'Georgia' },
  { id: 'wald', name: 'Wald', bg: '#0F3D3A', title: '#F1FBF8', text: '#BFE6DC', accent: '#F5C04A', font: 'Arial' },
];

export const SLIDE_LAYOUTS = [
  { id: 'title', name: 'Titel' },
  { id: 'title-text', name: 'Titel + Text' },
  { id: 'title-image', name: 'Titel + Bild' },
  { id: 'two-col', name: 'Zwei Spalten' },
  { id: 'blank', name: 'Leer' },
];
