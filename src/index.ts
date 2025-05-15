import "dotenv/config";
import flashcardsQuestions from "./scripts/flashcardsQuestions";
import flashcardsResponses from "./scripts/flashcardsResponses";
import quizzesFeeback from "./scripts/quizzesFeeback";
import quizzesQuestions from "./scripts/quizzesQuestions";
import updateStories from "./scripts/updateStories";
import clearAudio from "./scripts/clearAudio";
import clearQuizQuestions from "./scripts/clearQuizQuestions"; // Nouvelle importation
import { ScriptsEnum } from "./enums/ScriptsEnum";
import parseArgv from "./util/parseArgv";

(async () => {
  try {
    const params = parseArgv();
    
    console.log(`🏃 Exécution du script: ${params.script}`);
    
    if (params.level) {
      console.log(`📌 Niveau: ${params.level}`);
    }
    
    if (params.subject) {
      console.log(`📌 Matière: ${params.subject}`);
    }

    switch (params.script) {
      case ScriptsEnum.flashcardsQuestions:
        await flashcardsQuestions(params.level!, params.subject);
        break;
      case ScriptsEnum.flashcardsResponses:
        await flashcardsResponses(params.level!, params.subject);
        break;
      case ScriptsEnum.quizzesFeedbacks:
        await quizzesFeeback(params.level!, params.subject);
        break;
      case ScriptsEnum.quizzesQuestions:
        await quizzesQuestions(params.level!, params.subject);
        break;
      case ScriptsEnum.all:
        await Promise.all([
          flashcardsQuestions(params.level!, params.subject),
          flashcardsResponses(params.level!, params.subject),
          quizzesFeeback(params.level!, params.subject),
          quizzesQuestions(params.level!, params.subject)
        ]);
        break;
      case ScriptsEnum.updateStories:
        await updateStories();
        break;
      case ScriptsEnum.clearAudio:
        await clearAudio();
        break;
      case ScriptsEnum.clearQuizQuestions: // Nouveau cas
        await clearQuizQuestions(params.level!, params.subject);
        break;
    }

    console.log("✔️ Script exécuté avec succès");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erreur:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();