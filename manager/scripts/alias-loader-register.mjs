import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Enregistre le résolveur d'alias `@/…` pour les tests de modules purs.
register('./alias-loader.mjs', pathToFileURL('./scripts/'));
