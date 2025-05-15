import { SubjectEnum } from "../enums/SubjectEnum";

interface ElevenLabsTTSParams {
  text: string;
  voice_id: string;
  model_id?: string;
  voice_settings?: {
    stability: number;
    similarity_boost: number;
    style?: number;
    speaker_boost?: boolean;
    speed?: number;
  };
}

const getTTSParams = (language: SubjectEnum, text: string): ElevenLabsTTSParams => {
  let voiceId: string;

  switch (language) {
    case SubjectEnum.ENGLISH:
      voiceId = "9BWtsMINqrJLrRacOk9x";  
      break;
    case SubjectEnum.ARABE:
      voiceId = "tavIIPLplRB883FzWU0V";  
      break;
    case SubjectEnum.FRENSH:
    case SubjectEnum.MATH:
      voiceId = "pFZP5JQG7iQjIQuC4Bku";  
      break;
    default:
      voiceId = "pFZP5JQG7iQjIQuC4Bku"; 
      break;
  }

  return {
    text,
    voice_id: voiceId,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,        // 50% de stabilité
      similarity_boost: 0.75, // 75% de similarité
      speed: 1,              // Vitesse normale (1x)
    },
  };
};

export default getTTSParams;