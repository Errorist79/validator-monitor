import crypto from 'crypto';
import { config } from '../config/index.js';

const algorithm = 'aes-256-ctr';
const secretKey = config.jwt.secret;

export const encrypt = (text: string): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decrypt = (hash: string): string => {
  const [iv, content] = hash.split(':');
  const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(content, 'hex')), decipher.final()]);
  return decrypted.toString();
};
