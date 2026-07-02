'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALRroxTO1ghmGygJM0WMWY9zWk2XvQDdcZDBqbcb5qrM=
-----END PUBLIC KEY-----`;
const der = crypto.createPublicKey(PEM).export({ format: 'der', type: 'spki' });
const raw = der.subarray(der.length - 32); // ultimos 32 bytes = clave Ed25519 cruda
const bytes = [...raw].map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ');
const out = `/* Generado por gen-pubkey-header.js — NO editar a mano. Clave publica Ed25519 (32 bytes). */
#ifndef NEXUS_PUBKEY_H
#define NEXUS_PUBKEY_H
static const unsigned char NEXUS_PUBKEY[32] = { ${bytes} };
#endif
`;
fs.writeFileSync(path.join(__dirname, 'src', 'pubkey.h'), out);
console.log('pubkey.h generado. Clave (hex):', raw.toString('hex'));
