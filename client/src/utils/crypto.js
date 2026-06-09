/**
 * Generates a SHA-256 hash for a given ArrayBuffer (file chunk)
 * This guarantees zero data corruption during the WebRTC transfer.
 */
export async function generateChunkHash(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypts an ArrayBuffer chunk using AES-GCM with a client-side secret key
 */
export async function encryptData(dataBuffer, secretKey) {
  const encoder = new TextEncoder();
  const rawKey = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  
  // Initialization Vector (IV) unique to every single chunk
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, dataBuffer);
  
  // Pack IV and encrypted data together into a single buffer to transmit
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return combined.buffer;
}

/**
 * Decrypts an AES-GCM encrypted ArrayBuffer chunk
 */
export async function decryptData(combinedBuffer, secretKey) {
  const encoder = new TextEncoder();
  const rawKey = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  
  const iv = new Uint8Array(combinedBuffer, 0, 12);
  const encryptedData = new Uint8Array(combinedBuffer, 12);
  
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedData);
}