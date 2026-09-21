/* Minimal, dependency-free colored logger. */
const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function stamp() {
  return new Date().toISOString();
}

export const logger = {
  info: (...args) => console.log(`${colors.cyan}[info]${colors.reset}`, ...args),
  success: (...args) => console.log(`${colors.green}[ ok ]${colors.reset}`, ...args),
  warn: (...args) => console.warn(`${colors.yellow}[warn]${colors.reset}`, ...args),
  error: (...args) => console.error(`${colors.red}[fail]${colors.reset}`, ...args),
  debug: (...args) => console.log(`${colors.gray}[dbg ] ${stamp()}${colors.reset}`, ...args),
  /**
   * UN TITRE DE SECTION — la seule ligne du journal qui ne porte pas de niveau.
   *
   * Le démarrage énumère des dizaines de constats ; sans repères, ils forment
   * un mur. Les sections rendent lisible ce qui est déjà écrit, sans rien
   * ajouter au contenu — et un exploitant qui cherche « où en est le Panel »
   * n'a plus à lire les cinquante lignes qui précèdent.
   */
  section: (title) =>
    console.log(`\n${colors.gray}══ ${String(title).toUpperCase()} ${'═'.repeat(Math.max(0, 56 - String(title).length))}${colors.reset}`),
};

export default logger;
