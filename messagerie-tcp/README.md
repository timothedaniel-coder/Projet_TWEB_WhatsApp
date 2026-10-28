# 💬 Messagerie TCP

Application de messagerie en ligne de commande basée sur des **sockets TCP**, développée avec **Node.js**.

Elle permet à plusieurs utilisateurs de se connecter à un serveur central, d'échanger des messages privés, de diffuser des messages publics et de voir qui est en ligne.

---

## 📑 Sommaire

- [Prérequis](#-prérequis)
- [Lancement](#-lancement)
- [Commandes utilisateur](#-commandes-utilisateur)
- [Protocole client-serveur](#-protocole-client-serveur)
  - [Transport et cadrage](#transport-et-cadrage)
  - [Actions client → serveur](#actions-client--serveur)
  - [Actions serveur → client](#actions-serveur--client)

---

## 🔧 Prérequis

- [Node.js](https://nodejs.org/) installé sur votre machine

## 🚀 Lancement

**1. Démarrer le serveur**

```bash
node src/server/server.js
```

**2. Démarrer un client** (dans un autre terminal)

```bash
node src/client/client.js --name=votre_pseudo
```

> 💡 Vous pouvez lancer autant de clients que souhaité, chacun avec un pseudo différent.

---

## ⌨️ Commandes utilisateur

| Commande | Description |
| :--- | :--- |
| `hello` | Saluer le serveur. |
| `s;destinataire;message` | Envoyer un message **privé** à un utilisateur précis. |
| `b;message` | Diffuser un message **public** à tous les utilisateurs connectés. |
| `ls;` | Afficher la liste des utilisateurs actuellement en ligne. |
| `q;` | Quitter proprement la messagerie. |

**Exemples**

```text
hello
s;alice;Salut Alice, tu es là ?
b;Bonjour à tous !
ls;
q;
```

---

## 📡 Protocole client-serveur

### Transport et cadrage

| Élément | Détail |
| :--- | :--- |
| **Protocole** | TCP |
| **Encodage** | Objets JSON |
| **Délimitation** | Un objet JSON = un événement `data` unique sur la socket |

### Actions client → serveur

| Action | Champs obligatoires | Rôle |
| :--- | :--- | :--- |
| `client-connect` | `action`, `sender` | Enregistre l'utilisateur auprès du serveur. |
| `client-hello` | `action`, `sender` | Déclenche un message de bienvenue du serveur. |
| `client-send` | `action`, `sender`, `dest`, `msg` | Envoie un message privé à la cible `dest`. |
| `client-broadcast` | `action`, `sender`, `msg` | Envoie un message public à tous les connectés. |
| `client-list-clients` | `action`, `sender` | Demande la liste des utilisateurs actifs. |
| `client-quit` | `action`, `sender` | Informe le serveur de la déconnexion imminente. |

### Actions serveur → client

Toutes les actions envoyées par le serveur contiennent les champs `action`, `sender` et `msg`.

| Action | Rôle |
| :--- | :--- |
| `server-hello` | Réponse à la commande `hello`. |
| `server-send` | Relais du message privé (ou message d'erreur si le destinataire est absent). |
| `server-broadcast` | Relais du message public. |
| `server-list-clients` | Retourne la liste des utilisateurs sous forme de texte. |
| `server-event-join` | Notification spontanée d'une nouvelle connexion. |
| `server-event-leave` | Notification spontanée d'une déconnexion (volontaire ou non). |

**Exemple de message JSON**

```json
{
  "action": "client-send",
  "sender": "bob",
  "dest": "alice",
  "msg": "Salut Alice, tu es là ?"
}
```
