import mongoose from 'mongoose';

const colorsSchema = new mongoose.Schema(
  {
    primary: { type: String, required: true, trim: true },
    secondary: { type: String, required: true, trim: true },
    background: { type: String, required: true, trim: true },
    surface: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const derivedTokensSchema = new mongoose.Schema(
  {
    surfaceHeader: { type: String, trim: true, default: null },
    accent: { type: String, trim: true, default: null },
    accentStrong: { type: String, trim: true, default: null }
  },
  { _id: false }
);

// Scopes de thème (T1) : vitrine (site public) vs manager (panel admin/dev). Les anciens documents
// sans `scope` sont traités comme `vitrine` (lecture + migration).
export const THEME_SCOPES = ['vitrine', 'manager'];
export const DEFAULT_THEME_SCOPE = 'vitrine';

// Tokens visuels optionnels (additifs, n'altèrent pas l'existant s'ils sont vides).
const typographySchema = new mongoose.Schema(
  {
    fontFamily: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const themeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    // Scope du thème. Default vitrine pour rétro-compatibilité ; les docs legacy n'ont pas ce champ.
    scope: {
      type: String,
      enum: THEME_SCOPES,
      default: DEFAULT_THEME_SCOPE
    },
    colors: { type: colorsSchema, required: true },
    derivedTokens: {
      type: derivedTokensSchema,
      default: () => ({ surfaceHeader: null, accent: null, accentStrong: null })
    },
    // Tokens optionnels additifs (T1) — vides par défaut, donc aucun impact visuel si non renseignés.
    typography: { type: typographySchema, default: undefined },
    radius: { type: String, trim: true, default: '' },
    shadow: { type: String, trim: true, default: '' },
    spacing: { type: mongoose.Schema.Types.Mixed, default: undefined },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    logoUrl: { type: String, trim: true, default: '' },
    slogan: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() }
  },
  {
    timestamps: true,
    collection: 'themes'
  }
);

// Index de requête par scope (non unique).
themeSchema.index({ scope: 1 }, { name: 'theme_scope_idx' });
// Au plus UN thème actif par scope (index unique partiel sur les seuls documents actifs).
themeSchema.index(
  { scope: 1 },
  { name: 'theme_active_per_scope', unique: true, partialFilterExpression: { isActive: true } }
);

const Theme = mongoose.model('Theme', themeSchema);
export default Theme;
