import pool from "../util/db";
import * as readline from 'readline';

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

async function getQuizQuestionCount(client: any, level: string, subject?: string): Promise<number> {
  const queryParams: any[] = [level];
  let subjectCondition = '';

  if (subject) {
    subjectCondition = `AND s.title = $${queryParams.length + 1}`;
    queryParams.push(subject);
  }

  const countQuery = `
    SELECT COUNT(*) as count
    FROM question q
    JOIN quiz qui ON q.quiz_id = qui.id
    JOIN course c ON qui.course_id = c.id
    JOIN subject s ON c.subject_id = s.id
    JOIN level l ON l.id = c.level_id
    WHERE l.level_name = $1
    ${subjectCondition}
    AND q.question_audio IS NOT NULL
    AND qui.type = 'QUIZ'`;

  const countResult = await client.query(countQuery, queryParams);
  return parseInt(countResult.rows[0].count);
}

export default async function clearQuizQuestions(level: string, subject?: string) {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Vérification des questions de quiz...');
    console.log(`📌 Niveau: ${level}`);
    if (subject) console.log(`📌 Matière: ${subject}`);
    
    const count = await getQuizQuestionCount(client, level, subject);

    if (count === 0) {
      console.log('✔️ Aucune question de quiz avec audio trouvée');
      return { 
        cancelled: false,
        deletedCount: 0
      };
    }

    console.log('\n📊 Questions de quiz trouvées:');
    console.log(`- Nombre: ${count}`);

    const answer = await askQuestion('\n❓ Supprimer les références audio de ces questions de quiz ? (yes/y ou no/n): ');
    
    if (answer !== 'yes' && answer !== 'y') {
      console.log('\n❌ Opération annulée');
      return { cancelled: true };
    }

    console.log('\n🔧 Suppression en cours...');
    await client.query('BEGIN');

    const queryParams: any[] = [level];
    let subjectCondition = '';

    if (subject) {
      subjectCondition = `AND s.title = $${queryParams.length + 1}`;
      queryParams.push(subject);
    }

    const deleteQuery = `
      UPDATE question 
      SET question_audio = NULL 
      WHERE id IN (
        SELECT q.id
        FROM question q
        JOIN quiz qui ON q.quiz_id = qui.id
        JOIN course c ON qui.course_id = c.id
        JOIN subject s ON c.subject_id = s.id
        JOIN level l ON l.id = c.level_id
        WHERE l.level_name = $1
        ${subjectCondition}
        AND qui.type = 'QUIZ'
      ) RETURNING id`;

    const deleteResult = await client.query(deleteQuery, queryParams);
    const deletedCount = deleteResult.rowCount;

    await client.query('COMMIT');
    console.log('\n🎉 Suppression terminée');
    console.log(`- Questions modifiées en base: ${deletedCount}`);

    return {
      cancelled: false,
      deletedCount
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