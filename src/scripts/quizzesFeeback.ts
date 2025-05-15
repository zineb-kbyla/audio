import pool from "../util/db";
import axios, { CanceledError } from "axios";
import getTTSParams from "../util/getTTSParams";
import { IQuizzesQueryRes } from "../interfaces/IQuizzesQueryRes";
import sleep from "../util/sleep";
import { uploadFile, deleteFile } from "../util/s3";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const CHUNK_SIZE = 2;
const MAX_RETRIES = 5;
const BATCH_DELAY = 10000;

if (!ELEVENLABS_API_KEY) {
    throw new Error("❌ ELEVENLABS_API_KEY is not set in the environment variables.");
}

export const processFeedback = async (
    quiz: IQuizzesQueryRes,
    index: number,
    dbClient = pool,
    s3Upload = uploadFile,
    s3Delete = deleteFile
): Promise<IQuizzesQueryRes | null> => {
    let client;
    try {
        client = await dbClient.connect();
        console.log(`🔵 Début de la transaction pour le feedback ${quiz.questionid}.`);
        await client.query('BEGIN');

        if (!quiz.feedback || quiz.feedback.trim() === "") {
            console.warn(`⚠️ Feedback vide pour l'ID : ${quiz.questionid}`);
            await client.query('ROLLBACK');
            console.log("🔙 Transaction annulée (ROLLBACK) : Feedback vide.");
            return null;
        }

        const sanitizedFeedback = quiz.feedback.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿء-ي0-9 ?!.,+\-*/=()^%<>$€'"’]/gu, '') ; // Garde les apostrophes
        if (sanitizedFeedback.length === 0) {
            console.warn(`⚠️ Feedback invalide détecté pour l'ID : ${quiz.questionid}`);
            await client.query('ROLLBACK');
            console.log("🔙 Transaction annulée (ROLLBACK) : Feedback invalide.");
            return null;
        }

        console.log(`⏳ Traitement du feedback ${quiz.questionid}...`);
        await sleep(index * 100);

        const params = getTTSParams(quiz.language, sanitizedFeedback);
        console.log(`🎙️ Envoi à ElevenLabs: ${sanitizedFeedback}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log("🎙️ Envoi à ElevenLabs...");
                const response = await axios.post(
                    `${ELEVENLABS_API_URL}/${params.voice_id}`,
                    {
                        text: params.text,
                        model_id: params.model_id,
                        voice_settings: params.voice_settings,
                    },
                    {
                        headers: {
                            "xi-api-key": ELEVENLABS_API_KEY,
                            "Content-Type": "application/json",
                        },
                        responseType: "arraybuffer",
                        signal: controller.signal,
                    }
                );

                clearTimeout(timeout);
                console.log("✅ Réponse reçue de ElevenLabs.");

                const audioBuffer = Buffer.from(response.data, "binary");
                if (!audioBuffer || audioBuffer.length === 0) {
                    throw new Error("❌ Aucune donnée audio reçue de l'API ElevenLabs.");
                }
                console.log(`🎵 Taille du fichier audio : ${audioBuffer.length} bytes`);

                const s3Key = `audios-bewize/quizzes/feedbacks/${quiz.questionid}.mp3`;

                console.log(`📝 Mise à jour initiale de la base de données pour l'ID : ${quiz.questionid}`);
                const tempRes = await client.query(
                    "UPDATE question SET feedback_audio = 'PROCESSING' WHERE id = $1 RETURNING id",
                    [quiz.questionid]
                );

                if (tempRes.rowCount === 0) {
                    throw new Error(`❌ Initial SQL update failed for ID: ${quiz.questionid}`);
                }

                try {
                    console.log("📤 Tentative d'upload sur S3...");
                    await s3Upload(s3Key, audioBuffer, "audio/mpeg");

                    console.log(`✅ Upload sur S3 réussi : ${s3Key}`);
                } catch (s3Error) {
                    console.error(`❌ Erreur pendant l'upload sur S3: ${s3Error.message}`);
                    await client.query('ROLLBACK');
                    console.log("🔙 Transaction annulée (ROLLBACK) : Échec de l'upload sur S3.");
                    throw new Error(`S3 upload failed for ${quiz.questionid}`);
                }

                try {
                    console.log("📝 Tentative de mise à jour de la base de données...");
                    const updateRes = await client.query(
                        "UPDATE question SET feedback_audio = $1 WHERE id = $2 RETURNING id",
                        [s3Key, quiz.questionid]
                    );

                    console.log("📝 Résultat de la mise à jour :", updateRes.rowCount);

                    if (updateRes.rowCount === 0) {
                        throw new Error(`Final SQL update failed for ID: ${quiz.questionid}`);
                    }

                    await client.query('COMMIT');
                    console.log("✅ Transaction validée (COMMIT).");
                    console.log(`✅ Base de données mise à jour pour ${quiz.questionid}`);
                    quiz.feedback_audio = s3Key;
                    return quiz;
                } catch (sqlError) {
                    console.error(`❌ Erreur pendant la mise à jour SQL : ${sqlError.message}`);
                    await client.query('ROLLBACK');
                    console.log("🔙 Transaction annulée (ROLLBACK) : Échec de la mise à jour SQL.");

                    try {
                        await client.query(
                            "UPDATE question SET feedback_audio = NULL WHERE id = $1",
                            [quiz.questionid]
                        );
                        console.log("🔄 feedback_audio réinitialisé à NULL après échec SQL.");
                    } catch (resetError) {
                        console.error(`❌ Erreur lors de la réinitialisation de feedback_audio : ${resetError.message}`);
                        throw new Error(`Failed to reset feedback_audio: ${resetError.message}`);
                    }

                    try {
                        console.log(`🗑️ Suppression du fichier S3 : ${s3Key}`);
                        await s3Delete(s3Key);
                        console.log(`✅ Fichier S3 supprimé après échec SQL.`);
                    } catch (deleteError) {
                        console.error(`❌ Erreur lors de la suppression du fichier S3 (${s3Key}) : ${deleteError.message}`);
                    }
                    throw new Error(`Final SQL update failed for ID: ${quiz.questionid}`);
                }
            } catch (error) {
                if (error instanceof CanceledError) {
                    console.error("❌ La requête a été annulée.");
                    throw error;
                } else if (error.response && error.response.status === 401) {
                    console.error("❌ Unauthorized error: Please check your ELEVENLABS_API_KEY.");
                    throw error;
                } else if (error.response && error.response.status === 404) {
                    console.error("❌ Not Found error: Invalid request.");
                    throw error;
                } else if (error.response && error.response.status === 429) {
                    console.error("❌ Too Many Requests: Rate limit exceeded.");
                    throw error;
                } else if (error.response && error.response.status === 500) {
                    console.error("❌ Internal Server Error: Please try again later.");
                    throw error;
                } else {
                    clearTimeout(timeout);
                    await client.query('ROLLBACK');
                    console.log("🔙 Transaction annulée (ROLLBACK) : Erreur pendant le traitement.");
                    console.error(`❌ Erreur pendant le traitement : ${error.message}`);
                    throw error;
                }
            }
        }
        return null;
    } catch (error) {
        await client?.query('ROLLBACK');
        console.log("🔙 Transaction annulée (ROLLBACK) : Erreur pendant le traitement.");
        console.error(`❌ Erreur pendant le traitement : ${error.message}`);
        throw error;
    } finally {
        if (client) {
            client.release();
        }
    }
};

export const quizzesFeedback = async (level: string, subject?: string) => {
    console.log(`🔍 Exécution pour le niveau : ${level}${subject ? ` et la matière : ${subject}` : ''}`);

    let query = `
        SELECT que.id AS questionid, s.title AS language, que.feedback
        FROM subject s
        JOIN course c ON s.id = c.subject_id
        JOIN level l ON l.id = c.level_id
        JOIN quiz qui ON c.id = qui.course_id
        JOIN question que ON qui.id = que.quiz_id
        WHERE l.level_name = $1
        AND qui.type = 'QUIZ'
        AND (que.feedback_audio IS NULL OR TRIM(que.feedback_audio) = '')`;

    const queryParams: any[] = [level];

    if (subject) {
        query += ` AND s.title = $2`;
        queryParams.push(subject);
    }

    try {
        console.log("⚡ Exécution de la requête SQL...");
        const result = await pool.query(query, queryParams);
        const quizzes = <IQuizzesQueryRes[]>result.rows;

        if (quizzes.length === 0) {
            console.log("✅ Aucun feedback trouvé pour ces critères.");
            return [];
        }

        console.log(`🔍 Trouvé ${quizzes.length} feedbacks sans audio.`);

        const results = [];
        for (let i = 0; i < quizzes.length; i += CHUNK_SIZE) {
            const batch = quizzes.slice(i, i + CHUNK_SIZE);
            const batchResults = await Promise.all(batch.map((quiz, index) => processFeedback(quiz, index)));
            results.push(...batchResults.filter(result => result !== null));

            console.log(`⌛ Waiting for ${BATCH_DELAY / 1000} seconds before processing the next batch...`);
            await sleep(BATCH_DELAY);
        }

        console.log("🎉 Traitement terminé !");
        return results;
    } catch (error) {
        if (error.message.includes('Database connection failed')) {
            console.error("❌ Database connection failed:", error.message);
            throw new Error("Database connection failed");
        } else {
            console.error("❌ Error:", error.message);
            throw error;
        }
    }
};

export default quizzesFeedback;