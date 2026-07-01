'use strict';
/**
 * STUB — pg_dump ya no existe en Nexus Core (motor SQLite, ver backupService).
 * Se mantiene el contrato del módulo para no romper requires legacy;
 * todas las resoluciones retornan vacío/null.
 */

function parsePostgresMajor(_text) {
  return null;
}

async function getServerMajorFromDb(_db) {
  return null;
}

async function probePgDumpMajor(_dumpPath) {
  return null;
}

async function discoverWindowsPgDumpPaths() {
  return [];
}

async function resolvePgDumpCandidates(_db, _opts) {
  return { serverMajor: null, candidates: [], preferred: null };
}

async function warmupPgDumpResolution(_db) {
  return { serverMajor: null, preferred: null, candidates: [] };
}

function clearPgDumpResolutionCache() {}

module.exports = {
  parsePostgresMajor,
  getServerMajorFromDb,
  resolvePgDumpCandidates,
  warmupPgDumpResolution,
  clearPgDumpResolutionCache,
  probePgDumpMajor,
  discoverWindowsPgDumpPaths
};
