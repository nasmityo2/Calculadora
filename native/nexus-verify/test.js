'use strict';
const crypto = require('crypto');
const nv = require('nexus-verify');
let ok = true;
function assert(c, m) { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) ok = false; }

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const msg = Buffer.from('nexus test 123', 'utf8');
const sig = crypto.sign(null, msg, privateKey);
assert(nv.verifyDetachedWithKey(Buffer.from(pub), msg, sig) === true, 'acepta firma valida');
const bad = Buffer.from(sig); bad[0] ^= 0x01;
assert(nv.verifyDetachedWithKey(Buffer.from(pub), msg, bad) === false, 'rechaza firma alterada');
assert(nv.verifyDetachedWithKey(Buffer.from(pub), Buffer.from('otro'), sig) === false, 'rechaza mensaje alterado');

const PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALRroxTO1ghmGygJM0WMWY9zWk2XvQDdcZDBqbcb5qrM=
-----END PUBLIC KEY-----`;
const pemRaw = crypto.createPublicKey(PEM).export({ format: 'der', type: 'spki' }).subarray(-32);
assert(Buffer.compare(Buffer.from(nv.getEmbeddedPubKey()), Buffer.from(pemRaw)) === 0, 'clave embebida == PEM');
assert(nv.selfTest() === 424242, 'selfTest() = 424242');

console.log(ok ? '\n== TODO OK ==' : '\n== HUBO FALLOS ==');
process.exit(ok ? 0 : 1);
