# Tests pour les Flashcards et Quizzes

Ce projet contient des tests pour les fonctionnalités liées aux flashcards et aux quizzes, incluant la génération de fichiers audio via l'API ElevenLabs, le stockage sur AWS S3, et la mise à jour de la base de données. Les tests sont écrits en utilisant Jest, Sinon pour les mocks, et axios-mock-adapter pour simuler les requêtes HTTP.

## Structure des Tests

Les tests sont organisés en plusieurs fichiers, chacun correspondant à une fonctionnalité spécifique :

1. **flashcardsQuestions.test.ts** : Tests pour la génération de fichiers audio pour les questions des flashcards.
2. **flashcardsResponses.test.ts** : Tests pour la génération de fichiers audio pour les réponses des flashcards.
3. **quizzesQuestions.test.ts** : Tests pour la génération de fichiers audio pour les questions des quizzes.
4. **quizzesFeedback.test.ts** : Tests pour la génération de fichiers audio pour les feedbacks des quizzes.

## Fonctionnalités Testées

### 1. Interaction avec l'API ElevenLabs
- **Cas 1** : Appel réussi à l'API ElevenLabs pour générer un fichier audio.
- **Cas 2** : Gestion des erreurs 401 (non autorisé) lors de l'appel à l'API.
- **Cas 3** : Gestion des erreurs 429 (trop de requêtes) lors de l'appel à l'API.

### 2. Upload sur AWS S3
- **Cas 1** : Upload réussi d'un fichier audio sur S3.
- **Cas 2** : Gestion des erreurs lors de l'upload sur S3.

### 3. Mise à jour de la Base de Données
- **Cas 1** : Mise à jour réussie de la base de données avec l'URL du fichier audio sur S3.
- **Cas 2** : Gestion des erreurs lors de la mise à jour de la base de données.

### 4. Gestion des Transactions
- **Cas 1** : Rollback de la transaction en cas de question vide.
- **Cas 2** : Rollback de la transaction en cas de question invalide.

### 5. Génération des Paramètres TTS
- **Cas 1** : Génération des paramètres TTS pour l'anglais.
- **Cas 2** : Génération des paramètres TTS pour le français.
- **Cas 3** : Génération des paramètres TTS pour l'arabe.
- **Cas 4** : Utilisation des paramètres par défaut pour une langue non supportée.

### 6. Suppression de Fichiers sur S3
- **Cas 1** : Suppression réussie d'un fichier sur S3.
- **Cas 2** : Gestion des erreurs lors de la suppression d'un fichier sur S3.

## Configuration des Tests

Les tests nécessitent une configuration spécifique pour fonctionner correctement :

- **Variables d'environnement** : Assurez-vous que les variables d'environnement nécessaires (comme `ELEVENLABS_API_KEY`) sont définies dans un fichier `.env`.
- **Base de données** : Les tests utilisent une base de données PostgreSQL. Assurez-vous que la configuration de la base de données est correcte dans le fichier `.env`
- **AWS S3** : Les tests simulent les interactions avec AWS S3. Assurez-vous que les clés d'accès AWS sont correctement configurées.

## Exécution des Tests

Pour exécuter les tests, utilisez la commande suivante :

```bash
npm test
ou
npx jest flashcardsQuestions.test.ts
npx jest flashcardsResponses.test.ts
npx jest quizzesFeedback.test.ts
npx jest quizzesQuestions.test.ts  



# to run script you should run one of the following commands below

- yarn start --script flashcards/questions --level CP (this command generates voices for flashcards questions only for CP level)
- yarn start --script flashcards/responses --level CP (this command generates voices for flashcards responses only for CP level)
- yarn start --script quizzes/feedbacks --level CP (this command generates voices for quizzes feedbacks only for CP level)
- yarn start --script quizzes/questions --level CP (this command generates voices for quizzes questions only for CP level)
- yarn start --update/stories (this command updates the stories , "make sure that you change the stories.json in the root folder")

- yarn start --script clear/audio 
