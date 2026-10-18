// Document, spreadsheet and presentation templates (own designs). All texts are placeholders to overwrite.
import { SHEET_TEMPLATE_LIST } from './sheet-templates.js';
import { DOC_TEMPLATE_LIST, DOC_TEMPLATE_CATS, buildDocTemplate, SLIDE_DECK_CONTENT } from './doc-templates.js';

// Document templates live in doc-templates.js (pure data, reusable outside the editor); this is the gallery list.
export const DOC_TEMPLATES = DOC_TEMPLATE_LIST.map(t => ({ ...t, icon: 'kdoc', kind: 'docx', html: () => buildDocTemplate(t.id).html }));
export { buildDocTemplate, DOC_TEMPLATE_LIST, DOC_TEMPLATE_CATS };

// ---------------- spreadsheet templates ----------------
// Spreadsheet templates live in sheet-templates.js (pure data + builder); this is the gallery list.
export const SHEET_TEMPLATES = SHEET_TEMPLATE_LIST.map(t => ({ ...t, icon: 'ksheet', kind: 'xlsx' }));

// ---------------- presentation themes (own designs) ----------------
// panel: fill of cards/columns (Kennzahlen, Vergleich); strong: accent-coloured text (numbers, column headings) –
// title, text and strong keep a contrast of at least 4.5:1 on bg and on panel.
export const SLIDE_THEMES = [
  { id: 'indigo', name: 'Indigo', bg: '#1E1B5E', title: '#FFFFFF', text: '#D9DAF7', accent: '#2DD4BF', panel: '#2A2773', strong: '#2DD4BF', font: 'Arial' },
  { id: 'papier', name: 'Papier', bg: '#FFFFFF', title: '#15172F', text: '#4F5475', accent: '#3B37A0', panel: '#F3F3FA', strong: '#3B37A0', font: 'Arial' },
  { id: 'koralle', name: 'Koralle', bg: '#FFF6F0', title: '#3A1F17', text: '#5C4038', accent: '#E8613C', panel: '#FCE6DA', strong: '#A63A17', font: 'Georgia' },
  { id: 'wald', name: 'Wald', bg: '#0F3D3A', title: '#F1FBF8', text: '#BFE6DC', accent: '#F5C04A', panel: '#164B47', strong: '#F5C04A', font: 'Arial' },
  { id: 'mitternacht', name: 'Mitternacht', bg: '#0B1426', title: '#FFFFFF', text: '#C9D3E6', accent: '#F2A541', panel: '#16223A', strong: '#F2A541', font: 'Trebuchet MS' },
  { id: 'salbei', name: 'Salbei', bg: '#EEF3EC', title: '#1F3A2B', text: '#3D5546', accent: '#4E8A5F', panel: '#DDE8D9', strong: '#2F6B41', font: 'Georgia' },
  { id: 'terrakotta', name: 'Terrakotta', bg: '#F6EFE6', title: '#3B2418', text: '#5A4033', accent: '#B5542E', panel: '#EBDDCB', strong: '#8E3B1C', font: 'Palatino Linotype' },
  { id: 'kontrast', name: 'Kontrast', bg: '#111111', title: '#FFD60A', text: '#F0F0F0', accent: '#FFD60A', panel: '#262626', strong: '#FFD60A', font: 'Verdana' },
  { id: 'pflaume', name: 'Pflaume', bg: '#2A1636', title: '#FFFFFF', text: '#E5D3EE', accent: '#FF8FA3', panel: '#3A2149', strong: '#FF9EB0', font: 'Arial' },
  { id: 'ozean', name: 'Ozean', bg: '#E8F4F8', title: '#0B3954', text: '#2B5468', accent: '#0E7C9B', panel: '#D3EAF2', strong: '#0B5F78', font: 'Tahoma' },
];

export const SLIDE_LAYOUTS = [
  { id: 'title', name: 'Titel' },
  { id: 'title-text', name: 'Titel + Text' },
  { id: 'title-image', name: 'Titel + Bild' },
  { id: 'two-col', name: 'Zwei Spalten' },
  { id: 'agenda', name: 'Agenda' },
  { id: 'section', name: 'Abschnitt' },
  { id: 'quote', name: 'Zitat' },
  { id: 'kpi', name: 'Kennzahlen' },
  { id: 'timeline', name: 'Zeitleiste' },
  { id: 'compare', name: 'Vergleich' },
  { id: 'blank', name: 'Leer' },
];

// Ready-made presentations (gallery: #/neu/praesentation?design=<theme>&deck=<id>). The slide texts are German
// document content and live with the other template content in doc-templates.js (SLIDE_DECK_CONTENT).
export const SLIDE_DECKS = [
  { id: 'projekt', title: 'Projektvorstellung', desc: 'Ziele, Zeitplan, Kennzahlen und nächste Schritte', theme: 'ozean' },
  { id: 'referat', title: 'Referat / Vortrag', desc: 'Gliederung, Abschnitte, Zitat und Fazit für Schule und Studium', theme: 'salbei' },
  { id: 'pitch', title: 'Geschäftsidee / Pitch', desc: 'Problem, Lösung, Markt, Vergleich und Fahrplan', theme: 'mitternacht' },
  { id: 'verein', title: 'Vereins-Jahresbericht', desc: 'Rückblick, Zahlen, Kasse und Ausblick für die Mitgliederversammlung', theme: 'terrakotta' },
];
export { SLIDE_DECK_CONTENT };
