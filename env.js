// Carga .env (junto al código) antes que cualquier otro módulo lea process.env.
import { fileURLToPath } from 'node:url';
try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch { /* sin .env: ok en --dry-run */ }
