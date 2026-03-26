export const encryptMessage = (message) => {
  return Buffer.from(message).toString('base64');
};

export const decryptMessage = (encryptedMessage) => {
  return Buffer.from(encryptedMessage, 'base64').toString('utf8');
};

export const generateKeyPair = () => {
  const crypto = require('crypto');
  
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  return { publicKey, privateKey };
};

export const deriveSharedSecret = (privateKey, publicKey) => {
  const crypto = require('crypto');
  
  const serverECDH = crypto.createECDH('x25519');
  serverECDH.setPrivateKey(Buffer.from(privateKey, 'pem'));
  
  const sharedSecret = serverECDH.computeSharedKey(Buffer.from(publicKey, 'pem'));
  
  return sharedSecret.toString('hex');
};

export const hashPassword = async (password) => {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(password, 12);
};

export const verifyPassword = async (password, hash) => {
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(password, hash);
};
