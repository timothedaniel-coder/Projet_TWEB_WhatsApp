# 💬 Messagerie TCP

Application de messagerie en ligne de commande basée sur des **sockets TCP**, développée avec **Node.js**.

Elle permet à plusieurs utilisateurs de se connecter à un serveur central, d'échanger des messages privés, de diffuser des messages publics, mais aussi de créer et gérer des **groupes de discussion privés** avec un système complet de modération.
Grâce aux dernières mises à jour, l'application intègre désormais une **base de données persistante (SQLite)** et un **chiffrement de bout en bout (ECDH + AES-256)** pour garantir la sécurité des échanges.

---

## 📑 Sommaire

- [Prérequis](#-prérequis)
- [Lancement](#-lancement)
- [Commandes utilisateur](#-commandes-utilisateur)
  - [Authentification & Historique](#authentification--historique)
  - [Général & Messages directs](#général--messages-directs)
  - [Groupes & Modération](#groupes--modération)
- [Protocole client-serveur](#-protocole-client-serveur)
  - [Sécurité et Chiffrement](#sécurité-et-chiffrement)
  - [Transport et cadrage](#transport-et-cadrage)
  - [Format des erreurs](#format-des-erreurs)
  - [Principales actions JSON](#principales-actions-json)

---

## 🔧 Prérequis

- [Node.js](https://nodejs.org/) installé sur votre machine
- Dépendances du projet (SQLite et Bcrypt) à installer via la commande :
  
```bash
  npm install sqlite3 bcrypt
```

## 🚀 Lancement

**1. Démarrer le serveur**

```bash
node src/server/server.js
```

**2. Démarrer un client** (dans un autre terminal)

```bash
node src/client/client.js --name=votre_pseudo
```

> 💡 Vous pouvez lancer autant de clients que souhaité, chacun avec un pseudo différent. Au lancement, le client négociera automatiquement un canal sécurisé avant de vous inviter à vous authentifier.

---

## ⌨️ Commandes utilisateur

### Authentification & Historique
*(Nouveautés de la Partie 3)*

| Commande | Description |
| :--- | :--- |
| `register;motdepasse` | Créer un nouveau compte. Le mot de passe est haché avant d'être stocké. |
| `login;motdepasse` | Se connecter à un compte existant. |
| `history;` | Afficher l'historique de vos messages récupérés depuis la base de données. |

### Général & Messages directs

| Commande | Description |
| :--- | :--- |
| `hello` | Saluer le serveur et valider sa connexion. |
| `send;destinataire;message`| Envoyer un message **privé** à un utilisateur précis. |
| `b;message` | Diffuser un message **public** à tous les utilisateurs connectés. |
| `ls;` | Afficher la liste des utilisateurs actuellement en ligne. |
| `quit;` | Quitter proprement la messagerie. |

### Groupes & Modération

*(Les groupes sont privés par défaut. Seul le créateur peut inviter, expulser ou bannir.)*

| Commande | Description | Droits requis |
| :--- | :--- | :--- |
| `cg;nomDuGroupe` | Créer un nouveau groupe. | Tous |
| `groups;` | Lister tous les groupes existants sur le serveur. | Tous |
| `join;nomDuGroupe` | Rejoindre un groupe (nécessite une invitation). | Invités |
| `gbroadcast;groupe;msg` | Envoyer un message à tous les membres du groupe. | Membres |
| `msgs;nomDuGroupe` | Consulter l'historique des messages du groupe. | Membres |
| `members;nomDuGroupe`| Lister les membres actuels du groupe. | Membres |
| `states;nomDuGroupe` | Voir l'état complet (propriétaire, membres, invités, bannis). | Membres |
| `leave;nomDuGroupe` | Quitter le groupe. | Membres |
| `invite;groupe;pseudo`| Inviter un utilisateur à rejoindre le groupe. | Créateur |
| `kick;groupe;pseudo` | Expulser un membre du groupe. | Créateur |
| `ban;groupe;pseudo` | Bannir un utilisateur (l'expulse et bloque son retour). | Créateur |
| `unban;groupe;pseudo`| Lever le bannissement d'un utilisateur. | Créateur |

---

## 📡 Protocole client-serveur

Le projet respecte un contrat d'interopérabilité strict permettant à différents clients et serveurs de communiquer entre eux.

### Sécurité et Chiffrement
Avant tout échange métier, le client et le serveur effectuent un handshake **ECDH** (courbe `prime256v1`) non chiffré via les actions `client-key-exchange` et `server-key-exchange`. 
Une fois les clés dérivées, **l'intégralité des messages JSON suivants est chiffrée** (AES-256-CBC) et signée (HMAC-SHA256) pour garantir la confidentialité et l'intégrité des échanges.

### Transport et cadrage

| Élément | Détail |
| :--- | :--- |
| **Protocole** | TCP |
| **Encodage** | Objets JSON stringifiés |
| **Délimitation** | Un saut de ligne `\n` obligatoire à la fin de chaque objet JSON |

Le serveur est capable de traiter plusieurs requêtes arrivant dans un même flux TCP grâce à un système de buffer découpant les données sur le caractère `\n`.

### Format des erreurs

Toute erreur serveur respecte la structure JSON suivante :
```json
{
  "action": "server-error",
  "code": "nom-de-l-erreur",
  "msg": "Message d'explication lisible par l'humain"
}
```
*Exemples de codes : `not-registered`, `already-registered`, `group-not-found`, `not-member`, `not-owner`, `banned`, `not-invited`, `invalid-credentials`.*

### Principales actions JSON

**Quelques requêtes Client → Serveur**
*   `client-register` : `{"action": "client-register", "sender": "alice", "password": "pass"}`
*   `client-login` : `{"action": "client-login", "sender": "alice", "password": "pass"}`
*   `client-hello` : `{"action": "client-hello", "sender": "alice"}`
*   `client-send` : `{"action": "client-send", "sender": "alice", "dest": "bob", "msg": "Salut !"}`
*   `cgroupe` : `{"action": "cgroupe", "sender": "alice", "group": "wob"}`
*   `groups` : `{"action": "groups", "name": "alice"}` *(Exception : utilise `name` au lieu de `sender`)*
*   `gbroadcast` : `{"action": "gbroadcast", "sender": "alice", "group": "wob", "msg": "Hello"}`

**Quelques réponses / événements Serveur → Client**
*   `server-auth-ok` : Validation de l'authentification (inscription ou connexion).
*   `server-history` : Restitution de l'historique du compte depuis la base SQLite.
*   `server-user-joined` / `server-user-left` : Notification globale de connexion/déconnexion.
*   `server-send-ack` / `server-broadcast-ack` : Accusés de réception des messages.
*   `server-groups` : Renvoie la liste des groupes existants.
*   `server-gmessage` : Relais d'un message dans un groupe.
*   `server-group-left` : Notifie un départ (avec un motif `reason`: `leave`, `kick`, `ban`).