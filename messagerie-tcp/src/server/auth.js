const bcrypt = require('bcrypt');
const { createUser, findUserByName } = require('./database.js');

// Nombre de tours de salage pour Bcrypt (recommandation : 10 à 12)
const SALT_ROUNDS = 10;

/**
 * Inscrit un nouvel utilisateur en hachant son mot de passe.
 */
async function register(name, password) {
  if (!name || !password) {
    throw new Error('Pseudo et mot de passe requis.');
  }

  // 1. Vérifier si l'utilisateur existe déjà
  const existingUser = await findUserByName(name);
  if (existingUser) {
    const error = new Error('Ce pseudo est déjà utilisé.');
    error.code = 'USER_EXISTS';
    throw error;
  }

  // 2. Hacher le mot de passe avec Bcrypt
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // 3. Enregistrer en BDD
  const newUser = await createUser(name, passwordHash);
  return newUser;
}

/**
 * Authentifie un utilisateur en vérifiant son mot de passe haché.
 */
async function login(name, password) {
  if (!name || !password) {
    throw new Error('Pseudo et mot de passe requis.');
  }

  // 1. Rechercher l'utilisateur dans la BDD
  const user = await findUserByName(name);
  if (!user) {
    const error = new Error('Utilisateur non trouvé ou identifiants incorrects.');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  // 2. Comparer le mot de passe en clair avec le hash bcrypt
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    const error = new Error('Mot de passe incorrect.');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  // Authentification réussie (on ne renvoie JAMAIS le password_hash au reste de l'application)
  return {
    id: user.id,
    name: user.name,
    created_at: user.created_at
  };
}

module.exports = {
  register,
  login
};