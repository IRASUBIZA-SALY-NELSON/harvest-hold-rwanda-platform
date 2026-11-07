import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { canonicalJson } from '../../common/canonical-json.js';
import { config } from '../../config.js';

/**
 * Ed25519 signatures for certificates. The private key comes from CERT_SIGNING_KEY (PEM) in
 * production; in development one is created in ./keys on first start. The public key is
 * published at /.well-known/harvest-hold-certificates.pem so anyone can check a certificate.
 */
@Injectable()
export class SigningService {
  private readonly log = new Logger('Signing');
  private readonly privateKey: crypto.KeyObject;
  readonly publicKey: crypto.KeyObject;
  /** Short fingerprint of the public key, stored with each signature. */
  readonly keyId: string;

  constructor() {
    let pem = process.env.CERT_SIGNING_KEY?.replace(/\\n/g, '\n');
    if (!pem) {
      if (config.production) throw new Error('CERT_SIGNING_KEY is required in production (Ed25519 private key, PEM)');
      const file = path.resolve(config.test ? path.join(config.uploadsDir, '..', 'test-signing.pem') : './keys/certificate-signing.pem');
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const { privateKey } = crypto.generateKeyPairSync('ed25519');
        fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
        this.log.log(`created a development signing key at ${file}`);
      }
      pem = fs.readFileSync(file, 'utf8');
    }
    this.privateKey = crypto.createPrivateKey(pem);
    this.publicKey = crypto.createPublicKey(this.privateKey);
    const der = this.publicKey.export({ type: 'spki', format: 'der' });
    this.keyId = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  }

  sign(data: unknown): string {
    return crypto.sign(null, Buffer.from(canonicalJson(data)), this.privateKey).toString('base64url');
  }

  verify(data: unknown, signature: string | null | undefined): boolean {
    if (!signature) return false;
    try {
      return crypto.verify(null, Buffer.from(canonicalJson(data)), this.publicKey, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  publicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }
}
