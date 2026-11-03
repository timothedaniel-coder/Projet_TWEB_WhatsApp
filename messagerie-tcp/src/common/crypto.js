const crypto = require('crypto');

// Courbe elliptique standard pour ECDH
const CURVE_NAME = 'prime256v1';

/**
 * Génère une paire de clés ECDH (clé privée + clé publique en hexadécimal).
 */
function generateKeyPair() {
  const ecdh = crypto.createECDH(CURVE_NAME);
  ecdh.generateKeys();
  return {
    ecdh,
    publicKeyHex: ecdh.getPublicKey('hex')
  };
}

/**
 * Calcule le secret partagé à partir de la clé publique distante et dérive 2 clés distinctes :
 * - encKey (32 octets pour AES-256)
 * - macKey (32 octets pour HMAC-SHA256)
 */
function deriveSessionKeys(ecdhInstance, peerPublicKeyHex) {
  const sharedSecret = ecdhInstance.computeSecret(peerPublicKeyHex, 'hex');

  // Dérivation par hachage SHA-256
  const encKey = crypto.createHash('sha256').update(sharedSecret).update('enc').digest();
  const macKey = crypto.createHash('sha256').update(sharedSecret).update('mac').digest();

  return { encKey, macKey };
}

/**
 * Chiffre un objet JS ou une chaîne avec AES-256-CBC, ajoute un IV aléatoire et un HMAC.
 */
function encryptMessage(payloadObject, encKey, macKey, seq) {
  const iv = crypto.randomBytes(16);
  const jsonStr = JSON.stringify({ ...payloadObject, seq });

  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const ivHex = iv.toString('hex');
  const payloadToSign = `${ivHex}:${encrypted}`;

  // Calcul du HMAC pour garantir l'intégrité et l'authenticité
  const hmac = crypto.createHmac('sha256', macKey)
    .update(payloadToSign)
    .digest('hex');

  return JSON.stringify({
    iv: ivHex,
    ciphertext: encrypted,
    hmac
  });
}

/**
 * Déchiffre un message, vérifie le HMAC et valide le numéro de séquence (protection contre le rejeu).
 */
function decryptMessage(encryptedJsonStr, encKey, macKey, expectedSeq) {
  const { iv, ciphertext, hmac } = JSON.parse(encryptedJsonStr);

  // 1. Vérification du HMAC
  const payloadToSign = `${iv}:${ciphertext}`;
  const calculatedHmac = crypto.createHmac('sha256', macKey)
    .update(payloadToSign)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(calculatedHmac, 'hex'))) {
    throw new Error('HMAC invalide : le message a été altéré !');
  }

  // 2. Déchiffrement AES-256-CBC
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  const parsedData = JSON.parse(decrypted);

  // 3. Vérification du numéro de séquence anti-rejeu
  if (parsedData.seq !== expectedSeq) {
    throw new Error(`Rejeu détecté ou désynchronisation ! Reçu seq=${parsedData.seq}, attendu seq=${expectedSeq}`);
  }

  return parsedData;
}

module.exports = {
  generateKeyPair,
  deriveSessionKeys,
  encryptMessage,
  decryptMessage
};