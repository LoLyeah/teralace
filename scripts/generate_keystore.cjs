const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function findOpenSSL() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" version`, { stdio: 'pipe' });
      return cmd;
    } catch (e) {}
  }
  return 'openssl';
}

const openssl = findOpenSSL();
console.log('Using OpenSSL:', openssl);

const outDir = path.join(__dirname, '..', '.github', 'keystore');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const keyPath = path.join(outDir, 'release.key');
const certPath = path.join(outDir, 'release.crt');
const keystorePath = path.join(outDir, 'release.keystore');

console.log('1. Generating 2048-bit RSA private key...');
execSync(`"${openssl}" genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' });

console.log('2. Generating self-signed certificate (validity: 10000 days)...');
execSync(`"${openssl}" req -new -x509 -key "${keyPath}" -out "${certPath}" -days 10000 -subj "/CN=TeraLace/OU=App/O=TeraLace/L=City/ST=State/C=US"`, { stdio: 'inherit' });

console.log('3. Exporting PKCS#12 keystore (alias: teralace)...');
execSync(`"${openssl}" pkcs12 -export -in "${certPath}" -inkey "${keyPath}" -out "${keystorePath}" -name teralace -passout pass:teralace123`, { stdio: 'inherit' });

// Remove temporary private key and cert files so only the password-protected keystore remains
try { fs.unlinkSync(keyPath); } catch (e) {}
try { fs.unlinkSync(certPath); } catch (e) {}

console.log('4. Verifying keystore...');
const ksBuffer = fs.readFileSync(keystorePath);
const parsed = crypto.parsePKCS12(ksBuffer, { passphrase: 'teralace123' });

if (!parsed.privateKey || !parsed.certificate) {
  throw new Error('Failed to parse generated PKCS12 keystore!');
}

console.log('Keystore created successfully at:', keystorePath);
console.log('Keystore size:', ksBuffer.length, 'bytes');
console.log('Cert subject:', parsed.certificate.subject);
console.log('Cert valid from:', parsed.certificate.validFrom);
console.log('Cert valid to:', parsed.certificate.validTo);
console.log('Cert SHA-256 Fingerprint:', parsed.certificate.fingerprint256);

const b64 = ksBuffer.toString('base64');
const b64Path = path.join(outDir, 'keystore_base64.txt');
fs.writeFileSync(b64Path, b64);
console.log('Base64 saved to:', b64Path);
