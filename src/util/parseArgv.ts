import { ScriptsEnum } from "../enums/ScriptsEnum";

interface IParseArgvRes {
  script: ScriptsEnum;
  level?: string;
  subject?: string;
}

const parseArgv = (): IParseArgvRes => {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  const scriptsWithoutLevel = [
    ScriptsEnum.clearAudio,
    ScriptsEnum.updateStories
  ];

  for (let i = 0; i < args.length; i += 2) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const value = args[i + 1];
      result[key] = value;
    }
  }

  // Validation du script
  if (!result.script || !Object.values(ScriptsEnum).includes(result.script as ScriptsEnum)) {
    throw new Error(`Script invalide. Options valides: ${Object.values(ScriptsEnum).join(', ')}`);
  }

  // Validation du niveau (seulement pour les scripts qui en ont besoin)
  if (!scriptsWithoutLevel.includes(result.script as ScriptsEnum)) {
    if (!result.level) {
      throw new Error("Le paramètre --level est requis pour ce script");
    }
  }

  return {
    script: result.script as ScriptsEnum,
    level: result.level,
    subject: result.subject
  };
};

export default parseArgv;