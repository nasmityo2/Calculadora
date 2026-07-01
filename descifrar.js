const crypto = require('crypto');

const JWT_SECRET = 'e68828d2ba9452108ad2c9895578cf8d619b1fca21c3ef2d3cd82261868f45ee5ba101e1a0da8a912b76f6b0bd420e4c';

const payload = {
  v: 1,
  salt: "/Tv0ZTPMAXK3mHVX/9jaYQ==",
  iv: "D00c9AY9lWtYxx+l",
  tag: "/7z4Qcd2n3+QCW3pkODn9A==",
  data: "IzS4ScF3i7AJatZiFTOF6HyHvrY1Bs/+ppvxDel84qL6LjAVe7MoBlCUo6KyWtgP7FDzxekTph1zpSFr0kfP9xnrBZi0Q3HFH8S+snzQdudQ3aQ+XQRpxq8UNGdgwSVsCovnGVENynMBQ8mh7W6l/OlCeF5bSGUldglMLgHlUQa00Mic1tuQ0BbcnrZTIrviX7/uM+EtIpbkkdW6IFb1rhjIgr27thz2LBJQIMEQ+GZwtn2oHyAynh7sNMNy72cBBNiQgiWSwXGeoN5lbNlY6bEHQIqzb6lWlzQvQ13HwgvvD3f9IWDNaxQNyjTmnsLhNtOqE7GwwZpqnMUhWTX3pse7OJYbIFvWzE3rJ3amhAiCdnzPO+KLnWDi3IEhvpg/6BuiSNGs9DsVc1r6RAqZGLwIXAyn3OrHJxRXeMmH+vQWCixk48rGTWdZf72/bAngPKAISYr1NgBQoBL3DcdxD+8jEP6yPP2shzMkUK+6MB1Zv2UjvHKRFP7OTcvDu8kVij7AUvb1H0S6OqgAobHg99lT3T+103LwUeUdTzpuR89AXuKA7y0Q5Pow21uOcjVnDITfEBuuYLiOSTo5CKAwCsS4EdQbrprNJPJJb5t+BkTMAwsk0Ye+3n+wTdutesmva43od5u3iNoFBCWtzxywgYH0v0ziMpu22ELVRW2ruVz27FXdQs7ICHNMidehkdkK9yPamRcjqfOk6Mumqb+u77EHbkzICYgjkCRmZ9n3nhwi9Kp3+1YtSqj3HBoBYkV8IkRFbnE/XS/wWlnc+xZ2O/3RWl/qg4j3qny/yJ9FJwrk0sX5wLABmRc0yg0O+RQvdAib7SRArX49AP1W4QMxvBeS1sWBVBHi7/toBA=="
};

const salt = Buffer.from(payload.salt, 'base64');
const iv = Buffer.from(payload.iv, 'base64');
const tag = Buffer.from(payload.tag, 'base64');
const data = Buffer.from(payload.data, 'base64');

console.log('salt bytes:', salt.length, '| iv bytes:', iv.length, '| tag bytes:', tag.length, '| data bytes:', data.length);
console.log('---');

let found = false;

function tryDecrypt(key, label) {
  if (found) return;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    console.log(`✅ SUCCESS with: ${label}`);
    console.log('Plaintext:', decrypted.toString('utf8'));
    found = true;
  } catch (e) {
    console.log(`❌ ${label} -> ${e.message}`);
  }
}

// --- scrypt variants ---
tryDecrypt(crypto.scryptSync(JWT_SECRET, salt, 32), 'scrypt(utf8 secret, N=16384,r=8,p=1)');
tryDecrypt(crypto.scryptSync(Buffer.from(JWT_SECRET, 'hex'), salt, 32), 'scrypt(hex-decoded secret buffer)');
tryDecrypt(crypto.scryptSync(JWT_SECRET, salt, 32, { N: 1024, r: 8, p: 1 }), 'scrypt(utf8 secret, N=1024)');
tryDecrypt(crypto.scryptSync(JWT_SECRET, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), 'scrypt(utf8 secret, N=32768)');


// --- pbkdf2 variants ---
for (const iterations of [1000, 10000, 65536, 100000, 210000]) {
  for (const digest of ['sha256', 'sha512']) {
    tryDecrypt(crypto.pbkdf2Sync(JWT_SECRET, salt, iterations, 32, digest), `pbkdf2-${digest}(${iterations})`);
  }
}

// --- direct hash-based "KDF" fallbacks ---
tryDecrypt(crypto.createHash('sha256').update(JWT_SECRET).digest(), 'sha256(secret) no salt');
tryDecrypt(crypto.createHash('sha256').update(Buffer.concat([Buffer.from(JWT_SECRET), salt])).digest(), 'sha256(secret + salt)');
tryDecrypt(crypto.createHash('sha256').update(Buffer.concat([salt, Buffer.from(JWT_SECRET)])).digest(), 'sha256(salt + secret)');
tryDecrypt(crypto.createHmac('sha256', salt).update(JWT_SECRET).digest(), 'HMAC-SHA256(salt, secret)');
tryDecrypt(crypto.createHmac('sha256', JWT_SECRET).update(salt).digest(), 'HMAC-SHA256(secret, salt)');

if (!found) {
  console.log('---');
  console.log('No common pattern matched.');
}