'use strict';
/**
 * afterPack: aplica Electron Fuses al binario empaquetado ANTES de firmar.
 * Cierra bypasses: ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect, y fuerza cargar desde app.asar.
 * Nota: NO se habilita EnableEmbeddedAsarIntegrityValidation (no efectivo en Windows con Electron 22).
 */
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  // Solo Windows.
  if (context.electronPlatformName !== 'win32') return;

  const productFilename = context.packager.appInfo.productFilename; // "Nexus Core"
  const electronBinary = path.join(context.appOutDir, `${productFilename}.exe`);

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,                            // bloquea ELECTRON_RUN_AS_NODE
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // bloquea NODE_OPTIONS
    [FuseV1Options.EnableNodeCliInspectArguments]: false,        // bloquea --inspect / --inspect-brk
    [FuseV1Options.OnlyLoadAppFromAsar]: true                    // fuerza cargar desde app.asar
  });

  console.log('[afterPack-fuses] Fuses aplicadas a', electronBinary);
};
