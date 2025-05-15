import pool from "../util/db";
import * as readline from 'readline';
import { deleteFile } from '../util/s3'; // On ne garde que deleteFile puisque s3 n'est pas utilisé

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer.toLowerCase());
    });
  });
}

async function getAudioUrls(client: any): Promise<{urls: string[], stats: any}> {
  const queries = [
    client.query(`SELECT question_audio as url FROM question WHERE question_audio IS NOT NULL`),
    client.query(`SELECT feedback_audio as url FROM question WHERE feedback_audio IS NOT NULL`),
    client.query(`SELECT answer_audio as url FROM answer WHERE answer_audio IS NOT NULL`)
  ];

  const results = await Promise.all(queries);
  
  const urls = results.flatMap(result => 
    result.rows.map((row: any) => row.url).filter((url: string) => url)
  );

  const statsQuery = await client.query(`
    SELECT 
      (SELECT COUNT(*) FROM question WHERE question_audio IS NOT NULL) as questions,
      (SELECT COUNT(*) FROM question WHERE feedback_audio IS NOT NULL) as feedbacks,
      (SELECT COUNT(*) FROM answer WHERE answer_audio IS NOT NULL) as answers
  `);

  return {
    urls,
    stats: statsQuery.rows[0]
  };
}

function extractS3KeyFromUrl(url: string): string {
  const matches = url.match(/amazonaws\.com\/(.+)/);
  return matches ? matches[1] : url;
}

export default async function clearAudio() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Vérification des champs audio...');
    
    const { urls, stats } = await getAudioUrls(client);
    const totalAudio = stats.questions + stats.feedbacks + stats.answers;

    if (totalAudio === 0) {
      console.log('✔️ Aucun fichier audio à supprimer');
      return { 
        cancelled: false,
        stats: {
          initial: stats,
          remaining: stats
        },
        deletedFromS3: 0
      };
    }

    console.log('\n📊 Fichiers audio trouvés:');
    console.log(`- Questions: ${stats.questions}`);
    console.log(`- Feedbacks: ${stats.feedbacks}`);
    console.log(`- Réponses: ${stats.answers}`);
    console.log(`- Total URLs S3: ${urls.length}`);

    const answer = await askQuestion('\n❓ Supprimer ces fichiers audio (DB + S3) ? (yes/y ou no/n): ');
    
    if (answer !== 'yes' && answer !== 'y') {
      console.log('\n❌ Opération annulée');
      return { cancelled: true };
    }

    console.log('\n🔧 Suppression en cours...');
    await client.query('BEGIN');

    let deletedFromS3 = 0;
    if (urls.length > 0) {
      console.log('\n🗑️ Suppression des fichiers sur S3...');
      for (const url of urls) {
        try {
          const key = extractS3KeyFromUrl(url);
          await deleteFile(key);
          deletedFromS3++;
        } catch (error) {
          console.error(`❌ Erreur lors de la suppression de ${url}:`, error instanceof Error ? error.message : error);
        }
      }
    }

    if (stats.questions > 0) {
      await client.query(`UPDATE question SET question_audio = NULL WHERE question_audio IS NOT NULL`);
    }
    if (stats.feedbacks > 0) {
      await client.query(`UPDATE question SET feedback_audio = NULL WHERE feedback_audio IS NOT NULL`);
    }
    if (stats.answers > 0) {
      await client.query(`UPDATE answer SET answer_audio = NULL WHERE answer_audio IS NOT NULL`);
    }

    await client.query('COMMIT');
    console.log('\n🎉 Suppression terminée');
    console.log(`- Fichiers supprimés de S3: ${deletedFromS3}/${urls.length}`);

    const remaining = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM question WHERE question_audio IS NOT NULL) as questions,
        (SELECT COUNT(*) FROM question WHERE feedback_audio IS NOT NULL) as feedbacks,
        (SELECT COUNT(*) FROM answer WHERE answer_audio IS NOT NULL) as answers
    `);
    
    console.log('\n🔍 Résultat final:');
    console.table(remaining.rows[0]);

    return {
      cancelled: false,
      stats: {
        initial: stats,
        remaining: remaining.rows[0]
      },
      deletedFromS3
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Erreur:', error instanceof Error ? error.message : error);
    throw error;
  } finally {
    client.release();
    rl.close();
  }
}